import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { POST as createUploadSession } from "@/app/api/rooms/upload-session/route";
import { POST as createRoom } from "@/app/api/rooms/from-manifest/route";

async function main() {
  const keys = ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"];
  const previous = keys.map((key) => process.env[key]);
  const originalError = console.error;
  const errors: unknown[][] = [];
  try {
    keys.forEach((key) => delete process.env[key]);
    console.error = (...args: unknown[]) => { errors.push(args); };
    for (const [path, handler, action] of [
      ["upload-session", createUploadSession, "Preparing quiz upload"],
      ["from-manifest", createRoom, "Finalizing quiz"],
    ] as const) {
      const response = await handler(new NextRequest(`http://localhost/api/rooms/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }));
      assert.equal(response.status, 500);
      assert.match(response.headers.get("content-type") ?? "", /application\/json/);
      assert.deepEqual(await response.json(), {
        message: `${action} failed. Check the server logs for details.`,
      });
      const logged = errors.at(-1)!;
      assert.equal(logged[0], `[hosting] ${action} failed`);
      assert.ok(logged[1] instanceof Error);
      assert.match(logged[1].message, /Missing Firebase admin credentials/);
    }
  } finally {
    console.error = originalError;
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
