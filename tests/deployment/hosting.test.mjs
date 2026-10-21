import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";

test("the traced hosting deployment can load sharp and process a raster image", () => {
  const projectRoot = process.cwd();
  const tracePath = resolve(process.env.QUIZEE_NEXT_DIST_DIR ?? ".next", "server/app/api/rooms/from-manifest/route.js.nft.json");
  const trace = JSON.parse(readFileSync(tracePath, "utf8"));
  const deployment = mkdtempSync(join(tmpdir(), "quizee-hosting-deployment-"));
  try {
    // Copy only traced files, as a deployment does. Local node_modules must not
    // supply native libraries that are missing from the deployment artifact.
    for (const file of trace.files) {
      const source = resolve(dirname(tracePath), file);
      const path = relative(projectRoot, source);
      assert.ok(!path.startsWith(".."), `Traced file is outside the project: ${source}`);
      const destination = join(deployment, path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }
    execFileSync(process.execPath, ["-e", `
      const assert = require('node:assert/strict');
      const platform = process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime ? 'linuxmusl' : process.platform;
      // A WebAssembly fallback must not mask a broken native deployment.
      require('@img/sharp-' + platform + '-' + process.arch + '/sharp.node');
      const sharp = require('./node_modules/sharp');
      async function main() {
        const image = await sharp({ create: { width: 2, height: 3, channels: 4, background: 'white' } }).png().toBuffer();
        const metadata = await sharp(image).metadata();
        assert.equal(metadata.width, 2);
        assert.equal(metadata.height, 3);
        assert.equal(metadata.format, 'png');
      }
      main().catch(error => { console.error(error); process.exitCode = 1; });
    `], { cwd: deployment, env: { ...process.env, NODE_PATH: "" }, stdio: "pipe" });
  } finally {
    rmSync(deployment, { recursive: true, force: true });
  }
});
