# Statistics operations and rollout

All operator commands use the configured Firebase Admin credentials and require an explicit target project. Data-changing commands also require the UID of a current statistics administrator. Keep credentials in the existing environment configuration, never in command arguments or reports. The examples assume `STATS_PROJECT_ID` and `STATS_ADMIN_UID` are exported locally; `STATS_PROJECT_ID` must match the script's `FIREBASE_PROJECT_ID` configuration.

The tools never write to live rooms. Historical games are added manually through the administration UI. Publication is an explicit administrator action. Published snapshots are never replaced from current room data.

## Index verification

Production Firestore changes are reviewed and applied manually by the maintainer. They are not part of the agent's implementation or PR work. The [index review](firestore-index-review.md) groups the changes by purpose and lists every composite index and single-field setting from the manifest.

Run the read-only deployment diff first:

```sh
npm run stats:indexes -- --project "$STATS_PROJECT_ID"
```

Exit 0 means all required composite and single-field configurations are ready. Exit 2 means indexes or field configurations are missing or still building. Exit 1 means verification failed. The emulator cannot establish production index coverage.

The implementation requires 47 composite indexes and 18 field configurations. Query definitions and `firestore.indexes.json` are checked against one another in CI. Single-field collection-group indexes support mapping reconciliation and unselected-snapshot discovery. Large unqueried payload maps and private text fields are exempted to avoid indexing every nested metric or roster entry. Existing room/question/answer index settings are not changed.

If the maintainer chooses to use the reviewed helper to apply the changes manually, run it locally after reviewing the manifest and exact diff:

```sh
npm run stats:indexes -- --project "$STATS_PROJECT_ID" --apply
```

This creates missing composite indexes and applies only the named statistics field settings. It never deletes an unrelated composite index. Creation is asynchronous. Repeat verification after Google reports the operations complete. A pending index is not ready. Avoid a blanket `firebase deploy` that proposes deletion of indexes absent from this feature's manifest.

Once verification exits 0, execute the bounded, read-only query probes against the deployed project:

```sh
npm run stats:verify-queries -- --project "$STATS_PROJECT_ID" --actor "$STATS_ADMIN_UID"
```

This exercises every sort direction and administration/cleanup query shape, including empty probe histories, without enabling public access or returning private payloads. Missing-index failures stop immediately. It complements the selected-game acceptance check; empty probe results do not establish realistic data or latency behavior.

The read-only check on `quizee-ua` on 2026-10-30 found all 47 composite indexes missing, 18 field updates required, and no unrelated composite indexes. No index was deployed during that check.

## Historical games: manual administration

The maintainer will add past games manually after implementation. There is no bulk import script, automatic import job, or import command.

1. Open `/stats/admin` and select the ended room from the paginated room list.
2. Choose **Create snapshot**. This saves a private review; merely opening the room does not create or publish anything.
3. Review the saved scores and warnings, supply only verified missing metadata, explicitly link people, and check maxima. Unknown identities and historical data may remain unavailable.
4. Save the review, acknowledge incomplete grading if necessary, and choose **Publish game** when ready.

Opening an existing review preserves its mappings, overrides, metadata, person IDs, and snapshot selection. An unpublished review can be explicitly refreshed. A published snapshot cannot be refreshed from current room data. Unsupported or malformed source data produces a clear error without creating a selected review; no scores, identities, or missing history are invented.

Older rooms are supported without migrating their data: image rounds can store scored questions in `prompts`, and flat `prompt` / `answer` text is preserved alongside media. The pre-stages boolean grader's one-point awards are recovered only for ordinary text/image rounds with complete question, accepted-answer and frozen-answer sets, finalized grading, and a matching recorded team-round score. Recovered awards carry private `legacy-correctness` provenance. Explicit point awards are always preserved; modern, mixed, wager, incomplete or unreconciled records do not receive inferred awards and retain unavailable coverage. Image-only distractors are not scored questions. Conflicting `questions` and `prompts` collections are refused.

After deploying reader compatibility changes, use **Refresh saved room results** on an affected unpublished review to capture recovered detail. Valid roster mappings, maxima and reviewed metadata are preserved. Review the new completeness and reconciliation results before publishing. Existing selected snapshots do not change automatically, and published baselines remain frozen.

## Rebuild and integrity

Rebuild a game only from its selected snapshot and current review:

```sh
npm run stats:ops -- rebuild --actor "$STATS_ADMIN_UID" --project "$STATS_PROJECT_ID" --game GAME_ID
npm run stats:ops -- rebuild --actor "$STATS_ADMIN_UID" --project "$STATS_PROJECT_ID" --game GAME_ID --apply --expected-version VERSION_FROM_DIFF
```

The dry run lists differing summary/history/person paths. Apply checks that version again and replaces contributions transactionally using the same calculation and replacement services as publication. An unchanged rebuild performs no writes and appends no audit event. Current room scores are never consulted, even if the room has been deleted.

For a person's aggregate or mapping-count drift:

```sh
npm run stats:ops -- person --actor "$STATS_ADMIN_UID" --project "$STATS_PROJECT_ID" --person PERSON_ID
npm run stats:ops -- person --actor "$STATS_ADMIN_UID" --project "$STATS_PROJECT_ID" --person PERSON_ID --apply --expected-version VERSION_FROM_DIFF
```

This recomputes totals from that person's validated published history and counts player/host mappings across all saved reviews. If history points at the wrong game version, rebuild the affected game first, then reconcile the person. A game rebuild applies differences against stored contributions; if a contribution and its person's totals were independently corrupted, both steps may be required. Unknown/manual corruption that cannot be reconciled is refused, not silently repaired. Numeric total reconciliation uses the shared tolerance; recorded winners still use exact scores.

```sh
npm run stats:ops -- integrity --actor "$STATS_ADMIN_UID" --project "$STATS_PROJECT_ID" --all
```

Integrity visits games, then people, in bounded pages. It never repairs automatically. Exit 2 indicates detected drift; exit 1 indicates a failed check. A checkpoint contains the phase and last ID and can be reused verbatim with `--after`. Full integrity scans read saved question/answer snapshots and individual histories and can be expensive on a large archive.

The `Statistics integrity` GitHub workflow is scheduled daily but disabled until repository variable `STATS_INTEGRITY_ENABLED=true`. Before enabling, configure variables `STATS_FIREBASE_PROJECT_ID`, `STATS_ADMIN_UID`, secrets `STATS_FIREBASE_CLIENT_EMAIL`, `STATS_FIREBASE_PRIVATE_KEY`, and a service account permitted to read Firestore. The actor must retain its statistics role. Review full-scan read costs before enabling. This workflow reports drift and never writes repairs.

## Retention and cleanup

There is no assumed retention period and no automatic destructive cleanup schedule. Until the maintainer chooses cutoffs, retain unselected copies and administrator history.

```sh
npm run stats:ops -- cleanup-snapshots --actor "$STATS_ADMIN_UID" --project "$STATS_PROJECT_ID" --cutoff 2026-01-01T00:00:00.000Z --all
npm run stats:ops -- cleanup-audit --actor "$STATS_ADMIN_UID" --project "$STATS_PROJECT_ID" --cutoff 2025-01-01T00:00:00.000Z --all
```

These are dry runs. Applying either requires `--apply` and the explicit cutoff. Future or malformed cutoffs are refused. Snapshot cleanup always retains the currently selected snapshot, published or unpublished. It also discovers partial copies whose parent review was never created. A transactional deletion claim prevents a copy or selection from racing cleanup. The claimed root remains until every descendant deletion succeeds, so interruption remains discoverable and resumable. Cleanup does not delete media objects, people, roles, rooms, or selected snapshots. Audit cleanup has its own cutoff and does not affect publication/history data.

## Diagnostics and success measurements

Structured request logs include a correlation ID, status/code, and elapsed time; the ID is returned in `X-Request-ID`. Operation logs include saved game/snapshot/version references, mutation duration/conflict codes, recorded-warning counts, published mapping-correction counts, and duplicate-resolution counts. Snapshot-copy failures are reported as failures. Logs remain outside Firestore. `/stats/admin/history` shows durable actor/action/time/reference history separately.

```sh
npm run stats:ops -- metrics --actor "$STATS_ADMIN_UID" --project "$STATS_PROJECT_ID" --all
```

The final metrics record reports published games, games with fully mapped available rosters/host, their share, and average review duration with its sample size. Review duration runs from the first saved review snapshot to publication, not game completion. Older records without a review start remain outside that duration sample. Mapping-correction and duplicate rates can be calculated from successful `edit-review` operation logs. `public-game-detail`, `public-player-detail`, and `public-host-detail` logs count server detail requests, including refetches, not unique visitors. No third-party analytics destination or production latency target is configured; these remain maintainer decisions. Never add answer text, notes, auth tokens, or provider email addresses to telemetry.

## Measured local fixtures

Measurements below were made on 2026-10-30 against local Firebase emulators and exclude media payloads. They establish tested behavior for these fixtures, not production latency, billing, capacity limits, or SLOs.

| Fixture | Observed result |
| --- | --- |
| Typical upper range: 2 teams, 6 players, 9 rounds, 90 questions | 328 snapshot documents, 49,319 JSON data bytes; largest document 515 bytes. |
| Archive query fixture: 10,000 games, 5,000 people, 1,000-game player and host histories | 31,999 documents, 50,979,245 JSON data bytes; largest document 2,810 bytes. Seeding 65,329 ms; all required sort directions, complete default pagination, alias lookup, and two history profiles 11,860 ms combined. The profile pair and alias lookup took 364 ms. |
| Full source/copy/publication stress fixture: 20 teams, 120 players, 9 rounds, 90 questions | 2,040 snapshot documents, 237,034 JSON data bytes; largest document 554 bytes. Private create/link/90-maxima review writes 333 documents / 396,345 JSON bytes. Snapshot, review and successful atomic publication completed in 2,992 ms combined. |

The archive fixture uses snapshot headers and full relevant history rows to isolate query costs; it does not model millions of historical question documents or a fully imported archive. Full source copying and participant fan-out are exercised separately. The measured read workload made 11,320 SDK read calls and delivered 31,361 documents across all checks. These are SDK deliveries, not billed reads or a per-page cost estimate. Exact aliases, median, streaks, and roster frequencies remain proportional to one person's history. Measure real deployed query/index costs before exposing a large archive. The subsequent read-budget measurements below motivated shared immutable/versioned caching. No asynchronous aggregate layer is used.

### Statistics read budget

Web requests use the existing Next.js Data Cache, with compressed entries scoped to project, database, emulator environment, and deployment commit where available. Snapshots use immutable snapshot ID/digest/manifest keys; profile calculations and contribution pages use the live person version/update timestamp. Access checks and current names stay outside cache lookups. Payloads above the 1 MiB compressed-entry budget remain supported through uncached reads. Bump the `stats-read-v1` cache schema key when changing cached representations/calculations outside a deployment that provides `VERCEL_GIT_COMMIT_SHA`.

The administration UI performs one review fetch after a mutation or explicit reload. Tab focus performs none. Initial publication still reads the ended room to verify the approved digest, then pins the approved snapshot without copying it again. Existing snapshots need no migration. Operator integrity/rebuild tools read snapshots uncached and do not rely on the web cache. `stats.cache-read` server events report the cache scope and `hit`/`load` outcome without recording payloads or identity details.

The emulator regression uses a 90-question/two-team/six-player game and shared cache storage across two simulated web workers. Counts below include SDK document deliveries and empty-query minimums, but exclude index-entry billing and separate authentication HTTP checks. They are code-path regression budgets, not a guarantee about production bills or cold-cache traffic.

| Read path | Cold | Repeated with unchanged data |
| --- | --- | --- |
| Review without mappings | 332 | 5 |
| Review with six player mappings and a host | 344 | 17 |
| Save identity mappings against a cached snapshot | Not measured here | 26 |
| Player calculations, 100 games / five other people | 206 | 6 |
| Host calculations, 100 games | 201 | 1 |
| Player history table, 25 rows / one host | Reads its first contribution page | 52 |

Thus a repeated full 100-game player profile costs 58 reads (6 calculations + 52 table), and the host profile costs 53. First loads and new versions still need cold calculations. Global lists stay paginated; a shared host is read once per page instead of once per game. Public game detail reuses its already checked game/snapshot header.

`npm run test:stats:firestore` includes these budgets, revoked-role and snapshot-readiness checks, selection changes, live renamed people, archived profiles, publication snapshot reuse, and correction invalidation. Browser tests cover focus and duplicate-reload requests.

`npm run test:stats:load` requires the Firestore emulator and clears its dedicated demo project at the end. Run it in a fresh disposable emulator, never a shared development session. CI runs this fixture nightly and on manual workflow dispatch. The usual rules, unit, auth, service, browser, TypeScript, and deployment tests run on push/PR as well.

## Rollout and rollback

1. Review and merge the dependent draft PRs in order: foundation, snapshots, admin auth, publication, views, operations. Retarget each after its base merges. Do not squash later branches onto an unmerged base without preserving the earlier changes.
2. Keep `QUIZEE_STATISTICS_PUBLIC_ENABLED` unset or `false`. Administrator routes remain available; public pages/APIs/media and homepage navigation remain unavailable. Deploy the rules and code without broadening room access.
3. The maintainer reviews and manually applies the production index configuration, then waits for read-only verification to exit 0. Verify every promised query shape against deployed indexes; emulator success alone is insufficient.
4. Google login and first-admin bootstrap have been completed for the selected account. The maintainer can manually select historical ended rooms, create private snapshots, and review/publish them through `/stats/admin` after implementation. No import script or automatic historical processing is required. Do not publish synthetic emulator fixtures into the real project.
5. Review a deliberately selected ended game, link only verified identities, and acknowledge incomplete grading if applicable. Validate publication and a mapping/maximum correction in an isolated preview environment using the real deployed indexes. Verify public game/player/host views keep the pinned totals after live room scores change. Do not modify real game scores solely to test rollout.
6. Enable `QUIZEE_STATISTICS_PUBLIC_ENABLED=true` in the intended environment and redeploy. Check global/history sorting, private-data exclusion, media, mobile/keyboard access, and server logs. Choose production latency targets, retention cutoffs, analytics/log retention, and whether to enable scheduled full integrity scans based on the observed archive.

To roll public access back, set the flag to `false` and redeploy. This disables public reads and navigation without changing live gameplay, administrators, snapshots, mappings, histories, or published score baselines. Keep statistics data and indexes while investigating. Do not roll back by deleting selected snapshots, clearing all aggregates, reimporting published rooms, or weakening room rules.
