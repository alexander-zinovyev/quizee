import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, rename, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../../vendor/moq/node_modules/esbuild/lib/main.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const revision = JSON.parse(await readFile(path.join(root, "vendor/moq/revision.json"), "utf8"));
const libav = process.env.MOQ_LIBAV_DIRECTORY;
if (!libav) throw new Error("Set MOQ_LIBAV_DIRECTORY to the pinned upstream nix build .#moq-libav output. See vendor/moq/README.md.");
if (!/^[a-f0-9]{40}$/.test(revision.commit) || !/^[a-f0-9]{64}$/.test(revision.sourceSha256)) throw new Error("Invalid upstream pin or source checksum");
const scratch = await mkdtemp(path.join(tmpdir(), "quizee-moq-build-"));
const output = path.join(scratch, "bundle");
const destination = path.join(root, "public/moq", revision.commit);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

try {
  const response = await fetch(`https://codeload.github.com/moq-dev/moq/tar.gz/${revision.commit}`);
  if (!response.ok) throw new Error(`Upstream archive: HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (hash(archive) !== revision.sourceSha256) throw new Error("Upstream archive checksum mismatch");
  const archivePath = path.join(scratch, "source.tar.gz");
  await writeFile(archivePath, archive);
  const source = path.join(scratch, "source");
  await mkdir(source);
  execFileSync("tar", ["-xzf", archivePath, "--strip-components=1", "-C", source]);
  const patches = {};
  for (const file of (await readdir(path.join(root, "vendor/moq/patches"))).sort()) {
    const patch = path.join(root, "vendor/moq/patches", file);
    patches[file] = hash(await readFile(patch));
    execFileSync("patch", ["--batch", "--forward", "-p1", "-i", patch], { cwd: source, stdio: "inherit" });
  }
  // Normalize source and dependency paths so chunk names are independent of
  // temporary directory names and the checkout location.
  const installed = path.join(root, "vendor/moq/node_modules");
  const dependencies = path.join(source, "node_modules");
  await mkdir(dependencies);
  for (const file of await readdir(installed)) {
    await symlink(path.join(installed, file), path.join(dependencies, file), "dir");
  }
  await mkdir(path.join(dependencies, "@moq"));
  await symlink(path.resolve(libav), path.join(dependencies, "@moq/libav"), "dir");
  const workspace = {
    name: "pinned-moq-workspaces",
    setup(builder) {
      builder.onResolve({ filter: /^@moq\// }, async ({ path: specifier }) => {
        const [, name, ...rest] = specifier.split("/");
        if (name === "libav") return { path: path.join(dependencies, "@moq/libav/libav-opus-aac-af.mjs") };
        const directory = path.join(source, "js", name);
        const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
        const entry = manifest.exports[rest.length ? `./${rest.join("/")}` : "."];
        if (typeof entry !== "string") throw new Error(`Unsupported upstream export: ${specifier}`);
        return { path: path.resolve(directory, entry) };
      });
    },
  };
  const worklets = {
    name: "pinned-moq-worklets",
    setup(builder) {
      builder.onResolve({ filter: /\?(worklet|inline|raw)$/ }, ({ path: specifier, resolveDir }) => {
        const [file, kind] = specifier.split("?");
        const physical = file.startsWith(".") ? path.resolve(resolveDir, file) : path.join(dependencies, file);
        return { path: path.relative(source, physical).split(path.sep).join("/"), namespace: "moq-asset", pluginData: { kind, physical } };
      });
      builder.onLoad({ filter: /.*/, namespace: "moq-asset" }, async ({ pluginData }) => {
        const file = pluginData.physical;
        if (pluginData.kind !== "worklet") return { contents: `export default ${JSON.stringify(await readFile(file, "utf8"))}`, loader: "js" };
        const result = await build({ absWorkingDir: source, preserveSymlinks: true, entryPoints: [file], bundle: true, format: "iife", write: false, platform: "browser", minify: true, legalComments: "inline", plugins: [workspace], nodePaths: [dependencies] });
        const name = path.basename(file, ".ts") + ".js";
        const code = result.outputFiles[0].text;
        await writeFile(path.join(output, name), code);
        // Match upstream's lazy worklet loader, with its hosted-assets path preferred.
        return { contents: `let blob;export default async(base)=>base?new URL(${JSON.stringify(name)},base).href:(blob??=URL.createObjectURL(new Blob([${JSON.stringify(code)}],{type:"text/javascript"})));`, loader: "js" };
      });
    },
  };
  await mkdir(output, { recursive: true });
  const libavFiles = (await readdir(libav)).filter((file) => file.includes(".wasm."));
  if (!libavFiles.some((file) => file.endsWith(".wasm")) || !libavFiles.some((file) => file.endsWith(".mjs"))) throw new Error("Codec build must include the wasm module and worker");
  for (const file of libavFiles) await cp(path.join(libav, file), path.join(output, file));
  await build({
    stdin: {
      contents: `import {assets as publishAssets} from '@moq/publish';import {assets as watchAssets} from '@moq/watch';const base=new URL('./',import.meta.url);publishAssets(base);watchAssets(base);await Promise.all([import('@moq/publish/element'),import('@moq/watch/element')]);export const revision=${JSON.stringify(revision.commit)};`,
      resolveDir: source,
      sourcefile: "quizee-moq-elements.js",
    },
    absWorkingDir: source, preserveSymlinks: true,
    bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022", minify: true,
    outdir: output, entryNames: "elements", chunkNames: "chunks/[name]-[hash]", legalComments: "linked",
    plugins: [worklets, workspace], nodePaths: [dependencies],
  });
  const notices = [];
  async function copyNotices(directory, prefix) {
    for (const file of await readdir(directory)) if (/^(LICENSE|COPYING|PATENTS)|-(LICENSE|PATENTS)$/.test(file)) {
      const target = `${prefix}-${file}`;
      await cp(path.join(directory, file), path.join(output, target));
      notices.push(target);
    }
  }
  await copyNotices(source, "moq");
  for (const name of ["hang", "watch", "publish", "net"]) await copyNotices(path.join(source, "js", name), `moq-${name}`);
  await cp(path.join(libav, "README.md"), path.join(output, "libav-README.md"));
  const files = {};
  async function inspect(directory, prefix = "") {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await inspect(path.join(directory, entry.name), relative + "/");
      else files[relative] = hash(await readFile(path.join(directory, entry.name)));
    }
  }
  await inspect(output);
  const manifest = { ...revision, patches, entry: `/moq/${revision.commit}/elements.js`, libav: { recipe: `${revision.repository}/blob/${revision.commit}/js/libav/package.nix` }, notices, files };
  await mkdir(path.dirname(destination), { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await rename(output, destination);
  await writeFile(path.join(root, "vendor/moq/manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Built ${Object.keys(files).length} assets at ${manifest.entry}`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
