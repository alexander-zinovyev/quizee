import assert from "node:assert/strict";
import { getMediaPath, toBuilderMedia, toPackMedia, toPreviewMedia } from "./stage-media";

for (const durationSeconds of [0.1, 0.5, 2.75, undefined]) {
  const media = durationSeconds === undefined ? "song.mp3" : { path: "song.mp3", durationSeconds };
  const stage = toBuilderMedia(media);
  assert.equal(getMediaPath(media), "song.mp3");
  assert.equal(stage.durationSeconds, durationSeconds);
  assert.deepEqual(toPackMedia(stage), media);
  assert.equal(toPreviewMedia(stage)?.durationSeconds, durationSeconds);
  assert.equal(toPreviewMedia(stage)?.storagePath, "song.mp3");
}
assert.deepEqual(toBuilderMedia({ path: "song.mp3" }), { mediaPath: "song.mp3" });
assert.deepEqual(toBuilderMedia(), { mediaPath: null });
assert.equal(toPackMedia({ mediaPath: null }), undefined);
assert.equal(toPreviewMedia(), null);
