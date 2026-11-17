import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, "vendor/moq/manifest.json"), "utf8"));
const revision = JSON.parse(await readFile(path.join(root, "vendor/moq/revision.json"), "utf8"));
const directory = path.join(root, "public/moq", manifest.commit);

test("shipped MoQ assets are complete and match the immutable upstream pin", async () => {
  assert.equal(manifest.commit, revision.commit);
  assert.equal(manifest.sourceSha256, revision.sourceSha256);
  assert.match(manifest.commit, /^[a-f0-9]{40}$/);
  assert.equal(manifest.entry, `/moq/${manifest.commit}/elements.js`);
  for (const [file, expected] of Object.entries(manifest.patches)) {
    assert.equal(createHash("sha256").update(await readFile(path.join(root, "vendor/moq/patches", file))).digest("hex"), expected, file);
  }
  const actualFiles = (await readdir(directory, { recursive: true, withFileTypes: true })).filter((item) => item.isFile()).map((item) => path.relative(directory, path.join(item.parentPath, item.name))).sort();
  assert.deepEqual(actualFiles, Object.keys(manifest.files).sort());
  for (const [file, expected] of Object.entries(manifest.files)) {
    const bytes = await readFile(path.join(directory, file));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, file);
    if (file.endsWith(".js")) assert.doesNotMatch(bytes.toString(), /(?:https:\/\/esm\.sh|from\s*["']@moq\/|import\s*\(["']@moq\/)/, file);
  }
  for (const file of ["elements.js", "render-worklet.js", "capture-worklet.js", "capture-worker.js"]) assert(file in manifest.files, file);
  assert(Object.keys(manifest.files).some((file) => file.endsWith(".wasm.wasm")), "codec wasm is shipped");
});
