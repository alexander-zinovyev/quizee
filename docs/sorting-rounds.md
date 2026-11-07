# Sorting rounds

A sorting round has one criterion, at least two sortable questions, and an authored correct order. Each question uses a single Stage-shaped object: nonempty text, media, or both. Questions do not contain a `stages` array. In the builder, choose **Sorting**, enter the criterion, edit each question with the shared stage editor, then move questions into the correct order. Question IDs stay stable when the correct order changes.

A quiz pack contains `quiz.json` and optional files under `media/` in a `.tar.gz`. Media paths in quiz JSON are relative to `media/` and support the same image, audio, and video formats as other stage media.

```json
[
  {
    "type": "sorting",
    "title": "Timeline",
    "criterion": "Order these events from earliest to latest.",
    "questions": [
      { "id": "moon", "text": "First Moon landing" },
      { "id": "flight", "media": "events/first-flight.jpg" },
      { "id": "web", "text": "World Wide Web", "media": "events/web.mp3" }
    ],
    "correctOrder": ["flight", "moon", "web"]
  }
]
```

Each question has a unique ID containing letters, numbers, underscores, or dashes, with at most 1500 characters to fit a Firestore document ID. Every question must contain nonempty `text`, a supported `media` path, or both. `correctOrder` must contain every question ID exactly once. Nested `items` and `stages` shapes are refused. The builder validates imports and exports, and the server validates packs again when creating a room. Referenced media must exist in the pack.

In Firestore, the criterion belongs to `rooms/{roomId}/rounds/{roundId}`. Each sortable question is stored as Stage fields directly in `questions/{questionId}`; resolved media contains its Storage metadata. The single `answers/order` document contains `{ correctOrder: string[] }`. There is no synthetic question wrapping the list.

Opening sorting leaves the current foreground presentation in place. Activation creates one shuffled starting order, saves it as the round metadata’s `startingOrder` for host presentation, and saves a copy for every team at revision `0`. The live team round document, `rooms/{roomId}/teams/{teamId}/rounds/{roundId}`, contains `{ order: string[], revision: number, user: string | null }`. Teams do not need to submit the initial arrangement or press a save button. Untouched starting orders are scored.

Teams can drag from the question row with a mouse, or press and hold to drag on touch devices while ordinary swipes scroll. Keyboard users can focus a handle, press Space to pick up a question, use the up and down arrow keys to move it, then press Space to drop or Escape to cancel. Media playback and zoom controls remain independently usable. Reordering stays interactive while saves are in flight, and pending saves survive switching round tabs. Gameplay does not display routine saving/saved status text; failures retain visible recovery controls.

Each drop sends a relative edit, such as “A after C” or “A before E,” with a unique edit ID. The server validates the edit and atomically applies it to the current team order, increments that team's revision, and records the acknowledgement in the live team round's `edits/{editId}` subcollection. Duplicate delivery returns its original revision without applying the move again, including after the round has closed. Reusing an edit ID for a different operation is refused.

Clients retain the authoritative Firestore snapshot separately from pending edits. Adopting a newer snapshot and retiring all edits covered by its revision happens in one UI state update; acknowledgements also retire edits immediately if an already-received snapshot covers them. Remaining edits are replayed over that authoritative order. Each client sends its edits sequentially without freezing further interaction.

The host closes sorting independently. Closure atomically freezes the latest accepted `order`, `revision`, and `user` on `rounds/{roundId}/teamAnswers/{teamId}`. New edits after closing are refused with `round-closed`, while receipts for already accepted edits remain available through the authenticated save API. Grading adds the total `awardedPoints`, `pointsByQuestion`, and grading metadata to that frozen document. Ended rounds leave the player’s Interactive panel navigation. Hosts can still select them in the Interactive panel to inspect and reveal the correct order.

Each question in its correct position earns one point. With the correct order `A B C D`, submissions `A B C D`, `A C B D`, and `B A D C` earn 4, 2, and 0 points. These points contribute to round scores, standings, and published game history. Immediately after closure and scoring, the existing score breakdown modal shows the correct order, submitted order, points per entry, and round total, independently of the host's current presentation. Correct orders remain private to hosts while the round is active. The host can present the whole correct sequence from the round criterion, question documents, and `answers/order`, with no individual question selected.

Successful answer API responses include `Server-Timing` entries for authentication and the save transaction. Browser performance entries `sorting-edit.request` and `sorting-edit.firestore` measure request and snapshot propagation separately. The Firestore rules and authenticated HTTP integration tests report local emulator timings, including cold concurrent requests and a warm sequential save. These are diagnostic observations, not production latency targets.
