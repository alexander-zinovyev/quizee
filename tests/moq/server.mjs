import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../../", import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, "vendor/moq/manifest.json"), "utf8"));
const bundle = await build({
  entryPoints: [path.join(root, "tests/moq/client.jsx")], bundle: true, write: false,
  format: "esm", platform: "browser", jsx: "automatic", target: "es2022",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "image-placeholder", setup(builder) {
    builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: "image", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export default function Image(){return null}" }));
  } }],
});
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><div id="root"></div><script type="module" src="/fixture.js"></script>');
      return;
    }
    if (pathname === "/fixture.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(bundle.outputFiles[0].text);
      return;
    }
    if (process.env.MOQ_TEST_BROWSER_MODULE && pathname === manifest.entry) {
      response.setHeader("Content-Type", "text/javascript");
      response.end(await readFile(process.env.MOQ_TEST_BROWSER_MODULE));
      return;
    }
    const file = pathname === "/audio-worklets.js" ? path.join(root, "tests/moq/audio-worklets.js") : path.resolve(root, "public", "." + pathname);
    if (pathname !== "/audio-worklets.js" && !file.startsWith(path.join(root, "public") + path.sep)) throw new Error("Invalid asset path");
    response.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : file.endsWith(".json") ? "application/json" : "text/javascript");
    response.end(await readFile(file));
  } catch (error) {
    response.statusCode = error.code === "ENOENT" ? 404 : 500;
    response.end(String(error));
  }
});
server.listen(3029, "127.0.0.1", () => console.log("MoQ fixture ready"));
