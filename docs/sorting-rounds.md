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

Opening sorting leaves the current foreground question in place. Teams can switch between the sorting list and other open rounds, and teammates share the saved order. The host can close sorting independently. Closing freezes submissions; revealing the correct order is a separate host action. The authored order stays in private answer data until reveal.

Each item in its correct position earns one point. With the correct order `A B C D`, submissions `A B C D`, `A C B D`, and `B A D C` earn 4, 2, and 0 points. A team that never submits earns zero. These points contribute to round scores, standings, and published game history.
