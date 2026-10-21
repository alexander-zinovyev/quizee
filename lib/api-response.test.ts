import assert from "node:assert/strict";
import { readJsonResponse } from "./api-response";

async function main() {
  assert.deepEqual(await readJsonResponse(Response.json({ id: "july" }, { status: 201 }), "Finalizing quiz"), { id: "july" });
  for (const status of [404, 413, 500, 502, 504]) {
    await assert.rejects(readJsonResponse(new Response("<!DOCTYPE html><html>Server error</html>", {
      status, headers: { "Content-Type": "text/html; charset=utf-8" },
    }), "Finalizing quiz"), {
      message: `Finalizing quiz failed (HTTP ${status}): expected JSON but received text/html.`,
    });
  }
  await assert.rejects(readJsonResponse(Response.json({ message: "Upload session expired." }, { status: 410 }), "Finalizing quiz"), {
    message: "Finalizing quiz failed (HTTP 410): Upload session expired.",
  });
  await assert.rejects(readJsonResponse(Response.json(null, { status: 500 }), "Preparing quiz upload"), {
    message: "Preparing quiz upload failed (HTTP 500).",
  });
  await assert.rejects(readJsonResponse(new Response("{", { headers: { "Content-Type": "application/json" } }), "Finalizing quiz"), {
    message: "Finalizing quiz failed (HTTP 200): the server returned invalid JSON.",
  });
  await assert.rejects(readJsonResponse(new Response(null, { status: 502 }), "Preparing quiz upload"), {
    message: "Preparing quiz upload failed (HTTP 502): expected JSON but received an unknown response type.",
  });
  assert.deepEqual(await readJsonResponse(new Response('{"id":"july"}', { headers: { "Content-Type": "application/vnd.quiz+json" } }), "Finalizing quiz"), { id: "july" });
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
