# Firestore index changes for manual review

Production Firestore changes are reviewed and applied manually by the maintainer. This document describes the proposed index configuration; it does not apply it. The source of truth is [`firestore.indexes.json`](../../firestore.indexes.json).

## What changes and why

Firestore needs composite indexes to combine filters with sorting. The statistics pages support several sort columns in both directions, so each ordering needs its own index. Other indexes support identity searches and administration history.

| Purpose | Composite indexes |
| --- | ---: |
| Games: date, host, top score, total score, margin, pack, each direction | 12 |
| Players: seven leaderboard columns, each direction | 14 |
| Player game history: four columns, each direction | 8 |
| Hosted game history: four columns, each direction | 8 |
| Recorded-alias searches across player/host histories | 2 |
| Person name/helper-alias searches | 2 |
| Administrator history, newest first | 1 |
| **Total** | **47** |

Fields ending in `.availability` put unavailable values last. Fields ending in `.value` contain the sortable value. Completion date and `__name__` (document ID) provide stable tie breakers.

There are also 18 single-field configurations: two enable collection-group lookups for mapping counts and unselected snapshots; sixteen disable automatic indexing of payload/private fields that the application does not query. Exempting a field does not remove its stored data.

Index configuration targets collection IDs, such as `people`, rather than a `/stats/global` path prefix. Consequently, the field settings apply to every collection with the matching ID. Existing `rooms`, `rounds`, `questions`, `answers`, and `teams` index settings are not targeted by this manifest.

The proposed configuration does not change game records, scores, identities, role assignments, or security rules. It does not publish games or enable public statistics. Existing unrelated composite indexes should be retained.

## Exact composite index definitions

`ASC` and `DESC` are the field order directions. The rows below follow the manifest order; array fields use the array-contains setting.

| # | Collection ID | Query scope | Fields in order |
| ---: | --- | --- | --- |
| 1 | `games` | Collection | `published` ASC, `summary.sort.date.availability` ASC, `summary.sort.date.value` ASC, `__name__` ASC |
| 2 | `games` | Collection | `published` ASC, `summary.sort.date.availability` ASC, `summary.sort.date.value` DESC, `__name__` ASC |
| 3 | `games` | Collection | `published` ASC, `summary.sort.host.availability` ASC, `summary.sort.host.value` ASC, `summary.sort.date.availability` ASC, `summary.sort.date.value` DESC, `__name__` ASC |
| 4 | `games` | Collection | `published` ASC, `summary.sort.host.availability` ASC, `summary.sort.host.value` DESC, `summary.sort.date.availability` ASC, `summary.sort.date.value` DESC, `__name__` ASC |
| 5 | `games` | Collection | `published` ASC, `summary.sort.topScore.availability` ASC, `summary.sort.topScore.value` ASC, `summary.sort.date.availability` ASC, `summary.sort.date.value` DESC, `__name__` ASC |
| 6 | `games` | Collection | `published` ASC, `summary.sort.topScore.availability` ASC, `summary.sort.topScore.value` DESC, `summary.sort.date.availability` ASC, `summary.sort.date.value` DESC, `__name__` ASC |
| 7 | `games` | Collection | `published` ASC, `summary.sort.totalScore.availability` ASC, `summary.sort.totalScore.value` ASC, `summary.sort.date.availability` ASC, `summary.sort.date.value` DESC, `__name__` ASC |
| 8 | `games` | Collection | `published` ASC, `summary.sort.totalScore.availability` ASC, `summary.sort.totalScore.value` DESC, `summary.sort.date.availability` ASC, `summary.sort.date.value` DESC, `__name__` ASC |
| 9 | `games` | Collection | `published` ASC, `summary.sort.margin.availability` ASC, `summary.sort.margin.value` ASC, `summary.sort.date.availability` ASC, `summary.sort.date.value` DESC, `__name__` ASC |
| 10 | `games` | Collection | `published` ASC, `summary.sort.margin.availability` ASC, `summary.sort.margin.value` DESC, `summary.sort.date.availability` ASC, `summary.sort.date.value` DESC, `__name__` ASC |
| 11 | `games` | Collection | `published` ASC, `summary.sort.pack.availability` ASC, `summary.sort.pack.value` ASC, `summary.sort.date.availability` ASC, `summary.sort.date.value` DESC, `__name__` ASC |
| 12 | `games` | Collection | `published` ASC, `summary.sort.pack.availability` ASC, `summary.sort.pack.value` DESC, `summary.sort.date.availability` ASC, `summary.sort.date.value` DESC, `__name__` ASC |
| 13 | `people` | Collection | `hasPlayerHistory` ASC, `player.sort.gamesPlayed.availability` ASC, `player.sort.gamesPlayed.value` ASC, `__name__` ASC |
| 14 | `people` | Collection | `hasPlayerHistory` ASC, `player.sort.gamesPlayed.availability` ASC, `player.sort.gamesPlayed.value` DESC, `__name__` ASC |
| 15 | `people` | Collection | `hasPlayerHistory` ASC, `player.sort.wins.availability` ASC, `player.sort.wins.value` ASC, `__name__` ASC |
| 16 | `people` | Collection | `hasPlayerHistory` ASC, `player.sort.wins.availability` ASC, `player.sort.wins.value` DESC, `__name__` ASC |
| 17 | `people` | Collection | `hasPlayerHistory` ASC, `player.sort.winRate.availability` ASC, `player.sort.winRate.value` ASC, `__name__` ASC |
| 18 | `people` | Collection | `hasPlayerHistory` ASC, `player.sort.winRate.availability` ASC, `player.sort.winRate.value` DESC, `__name__` ASC |
| 19 | `people` | Collection | `hasPlayerHistory` ASC, `player.sort.ties.availability` ASC, `player.sort.ties.value` ASC, `__name__` ASC |
| 20 | `people` | Collection | `hasPlayerHistory` ASC, `player.sort.ties.availability` ASC, `player.sort.ties.value` DESC, `__name__` ASC |
| 21 | `people` | Collection | `hasPlayerHistory` ASC, `player.sort.losses.availability` ASC, `player.sort.losses.value` ASC, `__name__` ASC |
| 22 | `people` | Collection | `hasPlayerHistory` ASC, `player.sort.losses.availability` ASC, `player.sort.losses.value` DESC, `__name__` ASC |
| 23 | `people` | Collection | `hasPlayerHistory` ASC, `player.sort.teamPoints.availability` ASC, `player.sort.teamPoints.value` ASC, `__name__` ASC |
| 24 | `people` | Collection | `hasPlayerHistory` ASC, `player.sort.teamPoints.availability` ASC, `player.sort.teamPoints.value` DESC, `__name__` ASC |
| 25 | `people` | Collection | `hasPlayerHistory` ASC, `player.sort.pointPercentage.availability` ASC, `player.sort.pointPercentage.value` ASC, `__name__` ASC |
| 26 | `people` | Collection | `hasPlayerHistory` ASC, `player.sort.pointPercentage.availability` ASC, `player.sort.pointPercentage.value` DESC, `__name__` ASC |
| 27 | `playerGames` | Collection | `sort.date.availability` ASC, `sort.date.value` ASC, `__name__` ASC |
| 28 | `playerGames` | Collection | `sort.date.availability` ASC, `sort.date.value` DESC, `__name__` ASC |
| 29 | `playerGames` | Collection | `sort.teamPoints.availability` ASC, `sort.teamPoints.value` ASC, `sort.date.availability` ASC, `sort.date.value` DESC, `__name__` ASC |
| 30 | `playerGames` | Collection | `sort.teamPoints.availability` ASC, `sort.teamPoints.value` DESC, `sort.date.availability` ASC, `sort.date.value` DESC, `__name__` ASC |
| 31 | `playerGames` | Collection | `sort.result.availability` ASC, `sort.result.value` ASC, `sort.date.availability` ASC, `sort.date.value` DESC, `__name__` ASC |
| 32 | `playerGames` | Collection | `sort.result.availability` ASC, `sort.result.value` DESC, `sort.date.availability` ASC, `sort.date.value` DESC, `__name__` ASC |
| 33 | `playerGames` | Collection | `sort.pointPercentage.availability` ASC, `sort.pointPercentage.value` ASC, `sort.date.availability` ASC, `sort.date.value` DESC, `__name__` ASC |
| 34 | `playerGames` | Collection | `sort.pointPercentage.availability` ASC, `sort.pointPercentage.value` DESC, `sort.date.availability` ASC, `sort.date.value` DESC, `__name__` ASC |
| 35 | `hostedGames` | Collection | `sort.date.availability` ASC, `sort.date.value` ASC, `__name__` ASC |
| 36 | `hostedGames` | Collection | `sort.date.availability` ASC, `sort.date.value` DESC, `__name__` ASC |
| 37 | `hostedGames` | Collection | `sort.pointPercentage.availability` ASC, `sort.pointPercentage.value` ASC, `sort.date.availability` ASC, `sort.date.value` DESC, `__name__` ASC |
| 38 | `hostedGames` | Collection | `sort.pointPercentage.availability` ASC, `sort.pointPercentage.value` DESC, `sort.date.availability` ASC, `sort.date.value` DESC, `__name__` ASC |
| 39 | `hostedGames` | Collection | `sort.topScore.availability` ASC, `sort.topScore.value` ASC, `sort.date.availability` ASC, `sort.date.value` DESC, `__name__` ASC |
| 40 | `hostedGames` | Collection | `sort.topScore.availability` ASC, `sort.topScore.value` DESC, `sort.date.availability` ASC, `sort.date.value` DESC, `__name__` ASC |
| 41 | `hostedGames` | Collection | `sort.totalScore.availability` ASC, `sort.totalScore.value` ASC, `sort.date.availability` ASC, `sort.date.value` DESC, `__name__` ASC |
| 42 | `hostedGames` | Collection | `sort.totalScore.availability` ASC, `sort.totalScore.value` DESC, `sort.date.availability` ASC, `sort.date.value` DESC, `__name__` ASC |
| 43 | `playerGames` | Collection group | `namespace` ASC, `aliasesNormalized` ARRAY CONTAINS |
| 44 | `hostedGames` | Collection group | `namespace` ASC, `aliasesNormalized` ARRAY CONTAINS |
| 45 | `people` | Collection | `archived` ASC, `searchName` ASC, `__name__` ASC |
| 46 | `people` | Collection | `archived` ASC, `helperAliasesNormalized` ARRAY CONTAINS |
| 47 | `audit` | Collection | `at` DESC, `__name__` ASC |

## Exact single-field configurations

| Collection ID | Field | Proposed setting |
| --- | --- | --- |
| `mappings` | `personId` | Collection ASC; Collection DESC; Collection group ASC |
| `snapshots` | `snapshotAt` | Collection ASC; Collection DESC; Collection group ASC |
| `games` | `summary.metrics` | Exempt this field and its nested fields from automatic indexing |
| `people` | `player.counters` | Exempt this field and its nested fields from automatic indexing |
| `people` | `host.counters` | Exempt this field and its nested fields from automatic indexing |
| `people` | `notes` | Exempt this field and its nested fields from automatic indexing |
| `people` | `helperAliases` | Exempt this field and its nested fields from automatic indexing |
| `people` | `creationFingerprint` | Exempt this field and its nested fields from automatic indexing |
| `playerGames` | `byRoundType` | Exempt this field and its nested fields from automatic indexing |
| `playerGames` | `percentage` | Exempt this field and its nested fields from automatic indexing |
| `playerGames` | `poolPercentage` | Exempt this field and its nested fields from automatic indexing |
| `playerGames` | `roster` | Exempt this field and its nested fields from automatic indexing |
| `playerGames` | `rosterCoverage` | Exempt this field and its nested fields from automatic indexing |
| `playerGames` | `aliases` | Exempt this field and its nested fields from automatic indexing |
| `hostedGames` | `difficulty` | Exempt this field and its nested fields from automatic indexing |
| `hostedGames` | `teamPercentages` | Exempt this field and its nested fields from automatic indexing |
| `appearances` | `sourceUid` | Exempt this field and its nested fields from automatic indexing |
| `snapshots` | `sourceMembers` | Exempt this field and its nested fields from automatic indexing |

## Review and application

Review the manifest and these definitions before applying any production configuration yourself. The application code and PR creation do not authorize an agent to apply production Firestore changes. There is no automatic deployment of these settings in CI.

After you apply your reviewed configuration, the read-only `stats:indexes` and `stats:verify-queries` commands can check readiness and supported query shapes. See the [operations runbook](operations.md#index-verification). Index construction must finish before the affected queries can run.
