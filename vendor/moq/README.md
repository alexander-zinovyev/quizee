# Pinned MoQ browser build

Quizee ships upstream main commit `960a32f23148a16242e3512747fee45f1dd64f12` under `public/moq/<commit>/`. `revision.json` pins the source archive checksum. `manifest.json` records every shipped asset's SHA-256. The application loader and browser tests use the manifest's entry point. There are no runtime CDN imports or floating branch references.

This upstream snapshot fixes the reproduced Opus silence timeline drift and uses frame-arrival-based playout buffering. Published `@moq/publish@0.5.6` fixes the former; published `@moq/watch@0.6.6` still fails the recorded burst-delivery case. `@moq/token` remains a separate server-side dependency.

## Regeneration

Normal installs, builds and deployments use the checked-in browser assets and do not need Nix or the vendor toolchain. To regenerate:

```sh
npm ci --prefix vendor/moq
nix build github:moq-dev/moq/960a32f23148a16242e3512747fee45f1dd64f12#moq-libav --accept-flake-config --out-link /tmp/quizee-moq-libav
MOQ_LIBAV_DIRECTORY=/tmp/quizee-moq-libav npm run vendor:moq
npm run test:moq
```

The build downloads the exact source archive, verifies its checksum, and resolves every `@moq/*` workspace import from that source tree. Other build dependencies are pinned in this directory's lockfile. The esbuild asset adapter implements upstream's hosted/lazy worklet loader contract; the playout algorithm is unchanged. One explicit compatibility patch in `patches/` strips the Opus decoder description only for the libav fallback: upstream passes an OpusHead while the pinned polyfill accepts raw packets only. The patch applies to both capability probing and decoding, and its checksum is recorded in the manifest. Native decoding is unaffected. Source changes should be made upstream and pinned here in a new revision.

`@moq/libav@0.1.0` in this snapshot is not published to npm. Its upstream Nix recipe produces the Opus/AAC WebAssembly fallback, and upstream's signed `https://nix.moq.dev` cache can supply it. The build refuses a missing worker or wasm file. Both assets are shipped locally and exercised by a browser test with native audio codecs disabled. The fallback's corresponding source and pinned compiler recipe are linked in `manifest.json` and its shipped README; component license notices are embedded in its JavaScript. Upstream MoQ licenses and bundled dependencies' legal comments are retained beside the assets.

When updating, change the full commit and archive checksum, build the new assets, remove the previous commit directory, and review `manifest.json`. Keep the failing baseline results in `docs/moq-audio.md` so a new revision cannot silently weaken the audio acceptance criteria. The generated files are excluded from ESLint; they are verified byte-for-byte by the asset test instead.
