# Game statistics: high-level implementation plan

Status: Implementation in progress; release gates below remain required.  
Date: 2026-10-29  
Specification: [Game statistics technical specification](technical-spec.md)

The identifiers below are planning references, not existing Jira keys. Each story can become a Jira issue under its epic. Acceptance criteria describe behavior; engineers should split implementation subtasks after reviewing the design. Estimates and owners are intentionally unassigned until the snapshot and data-volume work is sized.

## Implementation progress

- Foundation: shared snapshot/review/public types, core scoring and identity calculations, indexed query plans, bound cursors, and checked-in indexes are implemented. Unit tests and emulator pagination/isolation coverage run in CI.
- Snapshot services: consistent read-only ended-room import, all four layout adapters, deterministic digests, create-only bounded storage, ready-manifest checks, and versioned unpublished refresh are implemented. Refresh clears changed roster mappings and updates private mapping counts atomically; these services have no browser/API entrypoint yet.
- Snapshot measurements: the representative 90-question fixture uses 328 documents and 47,689 JSON data bytes, largest document 515 JSON bytes, excluding media payloads. An 11-round emulator fixture verifies ordering, immutable scores, stale versions, revoked roles, roster refresh, and interrupted copying. JSON size and local emulator time do not establish production capacity or latency guarantees.
- Administrator access: isolated Google login/session, protected exact-user lookup and role grant/revoke UI, and first-admin bootstrap are implemented. Auth/Firestore emulator coverage verifies anonymous UID preservation, sessions, immediate revocation, repeated grants, and concurrent last-admin protection. Real-provider acceptance requires the [Firebase setup and selected first-admin UID](admin-setup.md).
- Publication/correction services: game projections, player/host contribution replacement, stable-ID create-and-link, explicit provisional publication, identity lifecycle/search, and archive guards are implemented. Emulator coverage changes and then removes the live room to prove later statistics edits keep the pinned scores; competing publication/corrections and archive races are covered. HTTP routes and the game-review/public UI follow this service change.
- Maintainer clarification: published correction confirmation belongs in the admin UI using already loaded review data. Do not add a separate preview API or a dry-run update mode.
- GS-01/02 remain open for source-adapter integration, complete contribution/aggregate contracts, and measured publication/history workloads. This foundation does not expose statistics pages or publish games.
- Representative sizing input from the maintainer: usually 2 teams, 3 players per team, 8-9 rounds, and 8-10 questions per round. Use 2 teams, 6 players, and 90 questions as the representative fixture, with larger stress fixtures; this is not a product limit.
- Proposed routes, collection names, and refresh-on-navigation/focus behavior are the implementation baseline. No production latency target, retention policy, or analytics destination has been chosen.

## Delivery decisions

Use Firestore throughout, Firebase Google admin sign-in, explicit admin publication only while room state is `ended`, inferred question maxima with admin overrides, closest-color exclusion from host difficulty, shared-first-only ties, and warning-acknowledged publication of incompletely graded games. Resolve duplicate person records by individual mapping corrections followed by archiving the unused record.

Publication permanently pins a recorded score baseline. Later changes to room scores by any actor are ignored, including during mapping/maxima edits, imports, or projection rebuilds. Immediate updates apply to statistics-admin corrections against that baseline. Existing completion, grading, scoring, and round-closure paths do not need refactoring for this feature; publication adds a read-only integration with ended-room data.

Group feature data under `stats/global/games`, `stats/global/people`, and `stats/global/audit`; account/role records use root `users` and `roles`. A game stores one selected snapshot and mutable review/summary data. A person stores identity plus player/host summary maps and history subcollections. Derive public aliases from mapped history. Retain a small admin change history; stable creation IDs and transactional version/no-op checks replace a generic operations collection.

## Epic GS-E1: Establish statistics contracts and calculations

Outcome: A tested model for source normalization, identities, publication, and metrics that every later story uses.

| Story | Deliverable | Acceptance criteria | Dependencies |
| --- | --- | --- | --- |
| GS-01: Define contracts and metric rules | Shared source/review/public DTOs and pure metric functions for all four round types. | Negative/fractional awards, first-place ties, inferred/fallback maxima, provisional/unknown outcomes, paired coverage, and closest-mode difficulty exclusion match the spec. Unknown inputs never become zero. Tests run in CI. | None |
| GS-02: Define Firestore models and indexed queries | The `stats/global` namespace, game/person contracts, contribution replacement model, sort/cursor schema, checked-in indexes. | One stats root collection; root account records named `users`/`roles`. Required queries use game summary fields or person `player`/`host` maps; aliases come from history. No second full game-detail copy or generic operations store. Measure transaction/history/search workloads. | GS-01 |

## Epic GS-E2: Create ended-game snapshots for independent statistics

Outcome: A consistent, immutable copy of available ended-game data with clear review warnings and no changes to existing game writes.

| Story | Deliverable | Acceptance criteria | Dependencies |
| --- | --- | --- | --- |
| GS-03: Create ended-room snapshots | Read-only consistent snapshot, supported-layout adapters, digest/read timestamp, and private immutable storage. | Only `ended` rooms are eligible. Save scores, grading flags, roster, rounds, questions and recorded answers in a snapshot without writing to the room. Missing completion date/pack metadata remains unknown; snapshot/publication dates remain distinct. | GS-01, GS-02 |
| GS-04: Review and refresh unpublished snapshots | Snapshot preview, reconciliation/completeness report, and explicit pre-publication refresh. | Show recorded totals and mismatches without repairing source scores. Refresh is allowed only while unpublished. Changed snapshot digest invalidates approval; changed roster entries need review. Missing metadata can be supplied in statistics review. | GS-03 |
| GS-05: Enforce statistics data isolation | Rules and server authorization boundaries for private snapshots and statistics writes. | Browser clients cannot read private snapshots or write statistics/admin records. Existing room-score permissions and gameplay behavior are preserved. Later room writes cannot mutate a snapshot. | GS-02 |

## Epic GS-E3: Add administrator authentication and roles

Outcome: Administrators can sign in and explicitly authorize other administrators without affecting gameplay identities.

| Story | Deliverable | Acceptance criteria | Dependencies |
| --- | --- | --- | --- |
| GS-06: Add isolated Google admin authentication | `/login`, separate Firebase admin auth instance/session cookie, server authorization helper. | Social login alone provides no admin access. Login/logout does not change an open game's anonymous UID. Sessions use CSRF protection and server-side role checks; non-admins receive a clear access state. | None |
| GS-07: Add role administration and bootstrap | Signed-in user lookup, audited grant/revoke UI, first-admin operator script. | Exact target identity is visible before granting. Revocation affects subsequent authorized requests. Concurrent role changes cannot remove the last admin. Bootstrap requires a specific existing Google-authenticated UID. | GS-06 |

## Epic GS-E4: Build publication and aggregate consistency

Outcome: Initial publication and later statistics-admin corrections commit coherently against a permanently pinned score baseline.

| Story | Deliverable | Acceptance criteria | Dependencies |
| --- | --- | --- | --- |
| GS-08: Calculate game and person summaries | Pure calculation from the saved snapshot plus review data; game summary and person history/aggregate inputs. | All round types produce correct views. Missing versus malformed data is distinguished. Public detail uses saved snapshot plus current review metadata, without a second full copy. Integer versions provide concurrency checks. | GS-01, GS-02, GS-04 |
| GS-09: Publish and replace contributions transactionally | Explicit publication command, pinned snapshot selection, publication metadata, per-player/host histories and aggregate deltas. | Publication rechecks live room state `ended`, ready snapshot, and approved digest; incomplete grading requires acknowledgement. Repeated publication preserves the baseline. Mapping/maxima edits update review, summaries/history, and admin change history atomically. | GS-05, GS-06, GS-08 |
| GS-10: Make admin corrections safe | Expected versions, stable-ID create/link behavior, transactional no-op checks and admin change-history events. | Conflicting edits fail clearly. Repeating a command creates no duplicate person, aggregate delta, or audit event. Mappings move contributions atomically. Maximum edits preserve recorded awards, totals and winners even when current room scores differ. | GS-06, GS-09 |

## Epic GS-E5: Build game review and identity administration

Outcome: An admin can prepare an ended game for publication and correct identity history safely.

| Story | Deliverable | Acceptance criteria | Dependencies |
| --- | --- | --- | --- |
| GS-11: Add people search and lifecycle | Search/create/edit person controls and empty-record archive. | Search matches display-name prefixes and exact helper/recorded aliases without auto-merging. Identically named people are allowed. Used records cannot be archived. Archived IDs remain tombstones. Private notes/helper data never leak publicly; public aliases derive from corrected published history. | GS-06, GS-10 |
| GS-12: Add review queue and game mapping | `/stats/admin` queue, roster/host context, partial mapping saves, duplicate-appearance resolution. | Complete unpublished games remain discoverable. Uncertain identities can stay unresolved. Same-person duplicate memberships count once; conflicting cross-team mappings require correction. Published mapping changes show aggregate-impact confirmation. | GS-08, GS-10, GS-11 |
| GS-13: Add maxima review and publication controls | Inferred/fallback maxima, overrides, source warnings, missing metadata corrections, publication preview/action. | Overrides preserve recorded awards. Fallback maxima and missing historical inputs retain provenance. Incomplete grading requires acknowledgement that the score snapshot/warning will remain despite later room grading. Only ended games can be published. | GS-09, GS-12 |

## Epic GS-E6: Deliver the public statistics experience

Outcome: Visitors can browse and inspect published game, player, and host history on mobile and desktop.

| Story | Deliverable | Acceptance criteria | Dependencies |
| --- | --- | --- | --- |
| GS-14: Add public queries and shared table navigation | Sanitized query services/API, stable cursors, URL sorting, reusable tables/expansion and metric help. | No login dependency. Required sorts operate across the full dataset; unknowns sort last. Pagination is stable for unchanged data. Only approved ended-state snapshots appear; current room scores/status are not queried. Private fields stay private. | GS-02, GS-09 |
| GS-15: Build `/stats` | Games/player collections, expandable rosters, links and completeness labels. | Default date/games-played order, all required global sorts, independent pagination, empty states, provisional counts, and mapped-history explanations work with multi-page fixtures. | GS-14 |
| GS-16: Build game detail and published media | Game/round comparisons, question/answer matrix, reconciliation labels, bounded detail loading, allowlisted assets. | All round types render the saved snapshot with current mappings/maxima. Signed/fractional scores and missing-data labels stay correct. Unpublished/unselected snapshots are private; pagination detects changed game versions. | GS-08, GS-14 |
| GS-17: Build player detail | Aliases, team participation metrics, sortable history, supported supplementary metrics. | A mapped player is counted despite unresolved teammates. Ties/unknowns/provisional outcomes match formulas. Team points are labeled as participation. Streaks, teammates/opponents, best/worst results and round-type breakdowns include coverage. | GS-14, GS-16 |
| GS-18: Build host detail | Hosted history, weighted difficulty proxy, median percentage, winning-score average and required sorts. | Only mapped published hosted games contribute; closest-color/unknown components are excluded from difficulty with coverage. Player and host routes share person IDs and cross-link where applicable. | GS-14, GS-16 |

## Epic GS-E7: Import, verify, and release

Outcome: Existing games can be reviewed without fabricated data, and release has operational and correctness evidence.

| Story | Deliverable | Acceptance criteria | Dependencies |
| --- | --- | --- | --- |
| GS-19: Import historical ended games | Dry-run/resumable importer and diagnostics. | Candidates remain private until admin publication. Missing dates/pack/detail are unavailable, not guessed. No aliases are auto-linked. Repeated import preserves mappings, overrides, IDs and publication decisions, and never replaces published snapshots with current room data. | GS-08, GS-12 |
| GS-20: Add reconciliation and operational visibility | Snapshot rebuild/diff command, unselected snapshot cleanup, integrity checks, admin change-history review, server telemetry and success metrics. | Rebuild uses the selected snapshot and current review; current room-score differences are ignored. Admin changes can be traced by actor/action/time. Debug logs remain outside Firestore. Agree retention and analytics destination. | GS-09, GS-10, GS-19 |
| GS-21: Complete acceptance and release rollout | CI-connected integration/rule/browser tests, production-index verification, representative load/cost results, rollout/rollback notes. | Non-ended publication is refused. After publication, change room scores as different actors and verify every public score/result remains frozen; then correct mappings/maxima and rebuild to prove the new room values never leak in. Auth isolation, required sorts, keyboard/mobile behavior, TypeScript and touched-code ESLint checks pass. | GS-05, GS-07, GS-13, GS-15, GS-16, GS-17, GS-18, GS-19, GS-20 |

## Milestones and sequencing

1. **Contract review complete:** Agree GS-01/02, the namespaced game/person model, consistency semantics, and representative capacity inputs. Confirm private snapshot-copy and transaction feasibility before broad UI work.
2. **Snapshot and access ready:** Complete GS-03 through GS-07. Statistics snapshot/isolation and admin-auth work are independent after contract review and can be scheduled concurrently. Existing gameplay paths remain unchanged.
3. **One complete vertical slice:** Publish one ended game, map its host/players, show game detail, change its room scores, and verify published scores stay frozen. Correct a mapping/maximum and verify all affected contributions still use the original baseline. Complete GS-08 through GS-10 plus a thin GS-12/14/16 slice before building out every page.
4. **Feature complete:** Finish the full review workflow and public pages. Run historical dry-run import early enough to expose actual source gaps.
5. **Release ready:** Finish GS-19 through GS-21, review real query/transaction costs, privately validate publication/correction, then enable public navigation.

The critical dependency chain is ended-room snapshot, summary calculations, atomic publication/contribution replacement, then public query/UI delivery. Page and admin UX work can be split once their contracts stabilize. There is no dependency on consolidating existing scoring or closure implementations.

## Backlog-wide definition of done

- Story acceptance criteria are demonstrated, including unavailable/provisional states.
- New behavior has meaningful automated coverage wired to existing CI, at least nightly; new tests are not left as standalone scripts.
- All new statistics call sites use the shared snapshot/query/metric contracts. Published projections always use the pinned baseline; existing gameplay write paths remain outside this change.
- Rules, indexes, migrations, and operational notes are delivered with their feature changes.
- Required TypeScript, touched-code ESLint, and relevant existing regression suites pass.
- No story expands into unrelated room/media/password cleanup. Any new scope or product limit is brought back to the technical lead.

## Estimate-sensitive items for planning

The largest uncertainties are the shape of real historical data, saved snapshot size, and contribution transaction fan-out. Alias/median/streak/frequency query costs depend on the longest individual history; administrator alias searches need scoped indexes. OAuth project setup, role bootstrap access, index deployment, admin history/snapshot retention, and analytics integration need named ownership before release. Existing scoring/closure refactoring is outside these estimates.
