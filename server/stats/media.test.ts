import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import type { Bucket } from "@google-cloud/storage";
import { serveStatsAsset } from "./media";

test("asset streaming honors byte ranges and forces a safe MIME type from the allowlisted filename", async () => {
  const bytes = Buffer.from("0123456789");
  const bucket = { file: (path: string) => {
    assert.equal(path, "rooms/demo/media/image.svg");
    return { getMetadata: async () => [{ size: String(bytes.length) }], createReadStream: ({ start = 0, end = bytes.length - 1 }: { start?: number; end?: number }) => Readable.from(bytes.subarray(start, end + 1)) };
  } } as unknown as Bucket;
  const response = await serveStatsAsset(new Request("https://quiz.test/asset", { headers: { Range: "bytes=2-5" } }), bucket, { storagePath: "rooms/demo/media/image.svg", contentType: "text/html" });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-type"), "image/svg+xml");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; sandbox");
  assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await response.text(), "2345");
  const invalid = await serveStatsAsset(new Request("https://quiz.test/asset", { headers: { Range: "bytes=99-" } }), bucket, { storagePath: "rooms/demo/media/image.svg", contentType: null });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get("content-range"), "bytes */10");
});

test("missing historical media is unavailable without exposing its Storage path", async () => {
  const bucket = { file: () => ({ getMetadata: async () => { throw Object.assign(new Error("PRIVATE path"), { code: 404 }); } }) } as unknown as Bucket;
  await assert.rejects(serveStatsAsset(new Request("https://quiz.test/asset"), bucket, { storagePath: "rooms/demo/media/private.png", contentType: "image/png" }), (error: unknown) =>
    error instanceof Error && error.message === "Historical media is unavailable.");
  await assert.rejects(serveStatsAsset(new Request("https://quiz.test/asset"), bucket, { storagePath: "rooms/demo/media/private.js", contentType: "text/javascript" }));
});
