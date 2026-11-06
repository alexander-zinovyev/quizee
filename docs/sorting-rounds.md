# Sorting rounds

A sorting round has one criterion, at least two items, and an authored correct order. In the builder, choose **Sorting**, enter the criterion, add item text or media using the stage editor, then move the items into the correct order. All stages belonging to an item are shown together. Item IDs remain stable when the correct order changes.

A quiz pack still contains `quiz.json` and optional files under `media/` in a `.tar.gz`. Item media paths are relative to `media/` and support the same image, audio, and video formats as other stage media.

```json
[
  {
    "type": "sorting",
    "title": "Timeline",
    "criterion": "Order these events from earliest to latest.",
    "items": [
      { "id": "moon", "stages": [{ "text": "First Moon landing" }] },
      { "id": "flight", "stages": [{ "media": "events/first-flight.jpg" }] },
      { "id": "web", "stages": [{ "text": "World Wide Web", "media": "events/web.mp3" }] }
    ],
    "correctOrder": ["flight", "moon", "web"]
  }
]
```

Each item has a unique ID containing letters, numbers, underscores, or dashes. Every stage must contain nonempty `text`, a supported `media` path, or both. `correctOrder` must contain every item ID exactly once. The builder validates imports and exports, and the server validates packs again when creating a room. Referenced media must exist in the pack.

Opening sorting leaves the current foreground question in place. Activation creates one shuffled starting order and saves a copy for every team at revision `0`. Teams can start dragging immediately; they do not need to submit the initial arrangement or press a save button. An untouched starting order is still scored.

Teams can drag from the item row with a mouse, or press and hold to drag on touch devices while ordinary swipes scroll. Keyboard users can focus a handle, press Space to pick up an item, use the up and down arrow keys to move it, then press Space to drop or Escape to cancel. Media playback and zoom controls remain independently usable. Reordering stays interactive while saves are in flight, and pending saves survive switching round tabs.

Each drop sends a relative edit, such as “A after C” or “A before E,” with a unique edit ID. The server validates the edit and atomically applies it to the current team order, increments that team's revision, and records an acknowledgement receipt. Duplicate delivery of the same edit returns its original revision without applying the move again, including after the round has closed. Reusing an edit ID for a different operation is refused.

The live team answer is `{ order: string[], revision: number, user: string | null }`. Clients retain the authoritative Firestore snapshot separately from their pending edits. Adopting a newer snapshot and retiring all edits covered by its revision happens in one UI state update; acknowledgements also retire edits immediately if an already-received snapshot covers them. Remaining edits are replayed over that authoritative order. Each client sends its own edits sequentially without freezing further interaction.

The host closes sorting independently. Closure atomically freezes the latest accepted order and revision; new edits after closing are refused with `round-closed`, while receipts for already accepted edits remain readable through the authenticated save API. Frozen answers retain the existing `{ answer: JSON.stringify(order), revision, user }` grading/history format. Revealing the correct order is a separate host action; the authored order stays in private answer data until reveal.

Each item in its correct position earns one point. With the correct order `A B C D`, submissions `A B C D`, `A C B D`, and `B A D C` earn 4, 2, and 0 points. These points contribute to round scores, standings, and published game history.

Successful answer API responses include `Server-Timing` entries for authentication and the save transaction. Browser performance entries `sorting-edit.request` and `sorting-edit.firestore` measure request and snapshot propagation separately. The Firestore rules and authenticated HTTP integration tests report local emulator timings, including cold concurrent requests and a warm sequential save. These are diagnostic observations, not production latency targets.
