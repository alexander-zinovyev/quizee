# MoQ audio regression and production playback check

Issue: [#43](https://github.com/alexander-zinovyev/quizee/issues/43).

The room media elements are self-hosted from upstream commit `960a32f23148a16242e3512747fee45f1dd64f12`. See [the build recipe](../vendor/moq/README.md) for provenance, regeneration, codec assets, and the recorded fallback compatibility patch.

## Automated reproduction

Run `npm run test:moq` after installing Playwright Chromium (`npx playwright install --with-deps chromium`). The fixture mounts the real `Member` component. One publisher and remote listeners use separate browser contexts and real WebTransport sessions through local moq-relay 0.17.17. The launcher verifies the downloaded Linux x64 relay against a pinned SHA-256; other platforms can set `MOQ_RELAY_BINARY` to that version's executable. The relay binds only to loopback, with disposable local certificate pinning and anonymous test broadcasts. No Firebase or production credentials are used.

An AudioWorklet generates a 997 Hz, amplitude 0.15 sine at 48 kHz. A MediaStream supplies that signal to the real microphone capture pipeline. This avoids Chromium's fake microphone timing behavior. Separate AudioWorklets record source and decoded receiver PCM. The tests compare signal energy and sample continuity rather than requiring byte equality through lossy Opus.

The burst test releases incoming unidirectional stream handles every 60 ms, retaining their original payloads, timestamps and order. This models delivery/scheduling jitter without intentionally losing packets. Each recording lasts 16 seconds; analysis excludes the first and final second. In the remaining interval, 10 ms windows must have RMS at least 0.03 (the source is about 0.106), and adjacent sample steps must stay below 0.06 (ordinary source steps peak around 0.0196). The production deployment test verifies that Next serves every pinned asset with its recorded checksum. The audio test also checks one publisher plus six listeners, quiet intervals, publishing/playback controls, and the self-hosted codec fallback.

The quiet profile alternates one second of tone with three seconds at amplitude 0.00001. Over 20 seconds, the encoded timestamp span must stay within 0.2 seconds of the source recording duration, allowing capture and frame boundaries. This catches Chromium's old DTX timeline compression.

Before the app change, the isolated baseline comparison produced:

| Build | Burst playback, repeated twice | Quiet publishing timeline |
| --- | --- | --- |
| publish 0.4.7 / watch 0.5.4 | 1.94 to 1.95 seconds of low-energy windows; 341 to 343 large discontinuity events per 14 seconds analyzed | 20.005 seconds compressed to 7.800 seconds |
| publish 0.5.6 / watch 0.6.6 | 12.37 to 13.10 seconds of low-energy windows; failed continuity | Correct within recording/frame boundaries |
| upstream main | Zero detected low-energy windows or large discontinuities | Correct within recording/frame boundaries |

The old/stable watchers sized auto jitter from minimum RTT, about 1 ms locally, and resolved only about 35 to 43 ms of playout buffering. Upstream main measures actual frame-arrival spread. A larger configured-delay diagnostic control removed long gaps, but retained one discontinuity on stable, so no fixed-delay workaround is applied. The default upstream adaptive policy is used.

The final real-component burst regression was also rerun with a temporary old publish/watch bundle served in place of the pinned entry. It failed with 208 low-energy windows; the checked-in bundle passed the same assertion. The test server supports `MOQ_TEST_BROWSER_MODULE=/absolute/path/to/elements.js` for such comparisons; the diagnostic module must export the manifest revision so the loader check does not mask the audio result.

These results reproduce media-pipeline failures. They do not establish which defect caused the original live room's clicks. The automated environment is headless Linux Chromium, audio-only participants, and a local relay. It does not reproduce physical microphones, output devices, Windows Chrome, macOS Safari, or production room/game transitions.

## Production playback check

After deploying the PR, verify in a disposable room:

1. Use Windows Chrome as a listener, then macOS Safari if available. Record browser/OS versions and the production relay version.
2. Start with one open microphone and one remote listener, both using headphones. Alternate normal speech and quiet intervals for several minutes. Compare local microphone audio with remote playback.
3. Expand to seven participants. If a click occurs for only some listeners, compare their recordings at the same timestamp and note the game/round state.
4. Exercise microphone/camera toggles, local playback mute and volume, team-only round audio, question media isolation, and round transitions. Check rejoining after muting.
5. Confirm the loaded module URL contains the pinned commit, and retain console/network diagnostics if playback or relay authentication fails.

The PR's automated checks do not replace this device/browser/production verification. The maintainer performs deployment, listening checks and merge.
