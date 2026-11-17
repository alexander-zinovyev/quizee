import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const version = "0.17.17";
const checksum = "a0174d4f9b2080be44554a5b1e557db34f264b8951acf62f9ae7b92c2099e272";
const cache = path.join(tmpdir(), "quizee-moq-relay", version);
let binary = process.env.MOQ_RELAY_BINARY;
if (!binary) {
  if (process.platform !== "linux" || process.arch !== "x64") throw new Error("Set MOQ_RELAY_BINARY to moq-relay 0.17.17 on this platform.");
  await mkdir(cache, { recursive: true });
  binary = path.join(cache, "moq-relay");
  let bytes;
  try { bytes = await readFile(binary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!bytes) {
    const response = await fetch(`https://github.com/moq-dev/moq/releases/download/moq-relay-v${version}/moq-relay-v${version}-x86_64-unknown-linux-gnu`);
    if (!response.ok) throw new Error(`Relay download: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== checksum) throw new Error("Relay checksum mismatch");
    await writeFile(binary, bytes);
    await chmod(binary, 0o755);
  }
  if (createHash("sha256").update(bytes).digest("hex") !== checksum) throw new Error("Cached relay checksum mismatch");
}
await mkdir(cache, { recursive: true });
const config = path.join(cache, "relay.toml");
await writeFile(config, '[listen]\nbind="127.0.0.1:4443"\ntls.generate=["localhost"]\n[web.http]\nlisten="127.0.0.1:4443"\n[auth]\npublic="**"\n[log]\nlevel="warn"\n');
const child = spawn(binary, [config], { stdio: "inherit", env: { ...process.env, RUST_LOG: "warn,moq_relay::web=info" } });
child.on("error", (error) => { console.error(error); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 0; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
