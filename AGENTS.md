# AGENTS.md

## App Purpose
This repository contains a multiplayer quiz platform.

### What the app does
- Host creates a room from a quiz pack (`quiz.json` + `media/` in `.tar.gz`).
- Teams join room, answer round questions, and scores are tracked.
- Supports two round types:
  - `text` rounds: staged prompt and staged answer reveal
  - `image` rounds: prompt + image matching/selection flow
- Host controls presentation (question visibility, page/stage navigation, answer reveal, round lifecycle).

### Roles
- Host:
  - creates room and starts game
  - controls presenting flow
  - grades text-round answers
  - can adjust awarded points
- Players:
  - join team
  - submit answers
  - view presentation and results based on room/game state

### Typical game flow
1. Host uploads pack and creates room.
2. Players join teams.
3. Host activates rounds and presents questions.
4. Players submit answers.
5. Host ends round and grades (text rounds), image rounds can be auto-graded.
6. Scores update and final standings are shown post-game.

---

## Repository Structure
- `app/`
  - Next.js routes/pages and room UI (`app/[room]/...`)
  - host/build flows (`app/host`, `app/build`)
  - API routes (`app/api/...`)
- `lib/`
  - reusable UI components (`lib/components/...`)
  - hooks and state logic (`lib/hooks/...`)
  - media transport/rendering logic (`lib/media/...`)
  - builder utilities (`lib/build/...`)
- `server/`
  - server-side validation/business logic (`server/rooms/...`)
- `types/`
  - shared schema and type definitions (`types/quiz.schema.json`, etc.)
- `firestore.rules`
  - Firestore security rules

---

## Data Schema & Validation

### Quiz Pack Schema
- Source of truth: `types/quiz.schema.json`
- Format:
  - top-level array of rounds
  - `text` round:
    - `title`
    - `questions[]` with `prompt.stages[]` and `answer { hint, stages[] }`
  - `image` round:
    - `title`
    - `questions[]` with required `image` and optional `prompt` stage

### Validation
- Client/build flow validates generated and loaded quiz JSON against schema.
- Server validates incoming quiz payload before room creation (`server/rooms/validation.ts`).
- Media path rules:
  - relative paths only
  - supported extensions only
  - referenced files must exist in pack media map

### Firestore Data
- Room document + nested round/question/answer/team subcollections.
- Presentation state includes question/answer visibility and page indices.
- Scoring stored per team and per round.

---

## Rules for Making Changes

### Architecture & quality
- Prefer clean, simple architecture over hotfix patches.
- If existing code is asymmetrical/legacy-driven, propose and apply focused refactor.
- Avoid introducing ad-hoc special cases when a reusable abstraction is possible.

### Reuse & modularity
- Create reusable components for repeated UI/logic patterns.
- Centralize media rendering behavior instead of duplicating branches.
- Keep data mapping/validation logic in dedicated utilities/hooks.

### Refactoring expectations
- Suggest refactoring when:
  - same logic appears in multiple places
  - naming/model no longer matches behavior
  - old historical paths cause bugs or inconsistency
- When refactoring:
  - update all call sites in same change
  - remove obsolete code paths
  - preserve existing behavior unless intentional change is requested

### Safety & verification
- Do not claim completion without applying and verifying changes.
- For non-trivial changes, run:
  - `npx tsc --noEmit`
  - `npx eslint <touched-files>`
- If asked to analyze only, do not modify files.
