# Technical Debt and Temporary Workarounds

Scan date: 2026-09-12

Scope: repository scan for temporary workarounds that need proper fixes and tech debt that needs refactoring. This scan was analysis-only. The current branch, `feat/moq`, has no upstream configured and no matching `origin/feat/moq`, so `git pull --ff-only` could not fast-forward before the scan.

## High Priority

### Plaintext room passwords are still written on room creation

The join endpoint can verify `passwordHash` and `passwordSalt`, but the active room creation path still writes the room password as plaintext.

References:
- `app/api/rooms/from-manifest/route.ts:361`
- `app/api/rooms/[room]/join/route.ts:117`

Proper fix:
- Add a server-side room-auth utility that hashes passwords consistently.
- Write only `passwordHash` and `passwordSalt` for new rooms.
- Decide whether legacy plaintext rooms should be migrated, accepted only temporarily, or rejected.
- Update README examples once the storage model is fixed.

### Team answer writes are too permissive

Firestore rules allow team members to write answers under `teams/{teamId}/rounds/{roundId}/answers/{answerId}` without checking whether the round is active or whether the submitted answer shape is valid.

References:
- `firestore.rules:112`

Proper fix:
- Restrict writes to the active round window.
- Validate that the caller belongs to the team.
- Validate allowed answer fields and types.
- Block writes after the round is closed.

### Round closure and answer copying are client-orchestrated

The host client copies team answers, closes the round, resets presentation state, then optionally calls server auto-grading for image rounds. A partial failure can leave the room in a mixed state.

References:
- `app/[room]/room-content.tsx:725`
- `app/[room]/room-content.tsx:789`

Proper fix:
- Move round closure and answer snapshotting to a server endpoint.
- Make the server workflow responsible for state transitions and auto-grading.
- Use transaction-oriented logic where possible.
- Keep the client as a command surface, not the owner of the state transition.

### Scoring logic is split across client and server paths

Manual grading and score recompute happen in client code, while image grading happens in a server route using a different update strategy. This makes score consistency depend on which path ran.

References:
- `app/[room]/room-content.tsx:838`
- `app/[room]/room-content.tsx:883`
- `app/api/rooms/[room]/rounds/[round]/grade/route.ts:205`

Proper fix:
- Move scoring to a server-owned service.
- Use one scoring model for text and image rounds.
- Make aggregate score updates idempotent.
- Tighten Firestore rules so clients cannot directly mutate score totals.

## Medium Priority

### API authentication is duplicated across routes

Bearer-token parsing, session-cookie verification, and auth error handling are repeated across most API routes.

References:
- `app/api/rooms/upload-session/route.ts:14`
- `app/api/rooms/from-manifest/route.ts:27`
- `app/api/rooms/[room]/daily/session/route.ts:14`
- `app/api/rooms/[room]/moq/session/route.ts:18`
- `app/api/rooms/[room]/rounds/[round]/grade/route.ts:9`

Proper fix:
- Extract a shared server auth helper.
- Support configurable log labels per route.
- Keep optional session-cookie creation for join behavior.
- Return a consistent authenticated-user shape.

### Media rules and content-type guessing are duplicated

Allowed extensions, path checks, media limits, and content-type mapping exist in multiple places. Some behavior is slightly different between client and server.

References:
- `app/host/page.tsx:15`
- `app/host/page.tsx:196`
- `server/rooms/validation.ts:45`
- `app/api/rooms/upload-session/route.ts:8`

Proper fix:
- Centralize media extension and content-type rules.
- Share upload-limit constants between session creation and client validation.
- Normalize media paths through one utility.
- Keep server validation authoritative.

### `RoomContent` and `RoomGate` are doing too much

`RoomContent` handles presentation, grading, score recomputation, countdowns, hand raising, media cache interactions, and layout. `RoomGate` combines membership, room state, roster composition, and media session management.

References:
- `app/[room]/room-content.tsx`
- `app/[room]/room-gate.tsx`

Proper fix:
- Split room membership and roster composition into a dedicated hook.
- Move presentation commands into a focused hook or client service.
- Move grading and scoring commands behind server endpoints.
- Keep UI components mostly presentational.

### Media URL loading has duplicated prompt, answer, and preload paths

Prompt media, answer media, and active-round preload logic each perform similar download URL, blob fetch, object URL, cache, and fallback handling. Cached object URLs are only cleared through an explicit callback.

References:
- `lib/hooks/use-presenting-media.ts:275`
- `lib/hooks/use-presenting-media.ts:332`
- `lib/hooks/use-presenting-media.ts:451`

Proper fix:
- Extract a media URL cache hook.
- Use one load path for prompt, answer, and preload.
- Revoke object URLs on unmount and when cache entries are evicted.
- Keep fallback-to-download-URL behavior explicit.

### MoQ transport uses roster-derived remote participants

The MoQ transport creates remote participant media sources from the member/team map rather than from a real media presence source. This blurs the difference between a room member and a connected media participant.

References:
- `lib/media/moq-transport.ts:108`

Proper fix:
- Add real MoQ presence/session discovery, if supported by the transport stack.
- Otherwise rename or model these entries as available roster media sources, not connected participants.
- Keep the `MediaTransport` interface honest about connection state.

### Several installed dependencies appear unused in source imports

Some packages in `package.json` were not found in source imports during the scan. A few may be planned for MoQ work or external tooling, but they currently add dependency surface without obvious runtime use.

Potential candidates:
- `@kixelated/hang`
- `@moq/net`
- `@opentelemetry/api`
- `dotenv`
- `drizzle-orm`
- `next-auth`
- `pg`
- `@types/pg`
- `drizzle-kit`

References:
- `package.json:16`
- `package.json:17`
- `package.json:21`
- `package.json:22`
- `package.json:23`
- `package.json:29`
- `package.json:30`
- `package.json:39`
- `package.json:43`

Proper fix:
- Verify whether these are used by deployment scripts, local experiments, or planned branches.
- Remove unused dependencies from `package.json` and `package-lock.json`.
- If some are intentionally reserved, add a short note in developer docs or keep them near the feature that imports them.

## Low Priority

### Daily transport uses unsafe adapter casts and swallows subscription errors

The Daily transport casts `DailyIframe` through `unknown` to access call-object APIs and ignores subscription update failures.

References:
- `lib/media/daily-transport.ts:62`
- `lib/media/daily-transport.ts:224`

Proper fix:
- Wrap Daily call-object access in a small typed adapter.
- Log or surface policy-application failures in a controlled way.
- Avoid silent failures for state that affects who can hear whom.

### Debug logging remains in room gate

`RoomGate` logs the current user id in the browser console.

References:
- `app/[room]/room-gate.tsx:57`

Proper fix:
- Remove the log or gate it behind a debug flag.

### `RoomPassword` component appears unused

The current join screen uses `RoomJoinPage`; no imports of `lib/components/room-password.tsx` were found. This looks like an older standalone password form.

References:
- `lib/components/room-password.tsx:24`
- `app/[room]/room-join-page.tsx:19`

Proper fix:
- Remove it if the old locked-room flow is gone.
- Otherwise reuse it inside `RoomJoinPage` so there is one password form implementation.

### Default starter assets appear unused

Several public SVG/PNG assets have no source references. `hand.svg` and `hand.mp3` are used, but the default starter-style files appear unused.

Potential candidates:
- `public/next.svg`
- `public/globe.svg`
- `public/window.svg`
- `public/file.svg`
- `public/vercel.svg`
- `public/placeholder.png`

References:
- `public/next.svg`
- `public/globe.svg`
- `public/window.svg`
- `public/file.svg`
- `public/vercel.svg`
- `public/placeholder.png`

Proper fix:
- Remove confirmed-unused public assets.
- Keep only assets referenced by UI or docs.

### README is stale around auth and room seeding

The README still documents placeholder password handling and an older seeded room shape.

References:
- `README.md:38`
- `README.md:53`

Proper fix:
- Update README after the password storage model is corrected.
- Replace old seed instructions with current room creation and auth behavior.

### No automated tests are present

No test files were found, and `package.json` has no test script.

References:
- `package.json:5`

Proper fix:
- Add focused regression tests for validation, password verification, room creation mapping, scoring, and Firestore rule expectations.
- Wire the test command into CI or at least a nightly workflow.
