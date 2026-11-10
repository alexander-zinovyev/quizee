# Clues rounds

Each team shares one coin budget across the entire round. Coins buy clues, not points. Correct answers earn one point; incorrect answers earn zero by default. Hosts grade answers and can adjust awards, including partial credit. Final awarded points feed standings and game history.

```json
[
  {
    "type": "clues",
    "title": "Name the city",
    "startingCoins": 16,
    "questions": [
      {
        "generalClue": { "text": "Which city is this?", "media": "cities/intro.aac" },
        "answer": { "hint": "Paris", "stages": [{ "text": "Paris", "media": "cities/answer.webm" }] },
        "clues": [
          { "id": "history", "category": "History", "price": 2, "content": { "text": "A European capital" } },
          { "id": "photo", "category": "Photo", "price": 3, "content": { "text": "Look at the skyline", "media": "cities/paris.png" } }
        ]
      }
    ]
  }
]
```

Budgets and prices must be positive safe integers. The builder defaults to 16 coins. Each question needs one `generalClue` stage, an `answer` with a separate host-only `hint` and one or more `stages`, and at least one paid clue. Each paid clue has a `content` stage. Clue IDs must be unique within their question and contain 1 to 128 letters, numbers, underscores, or dashes, excluding names wrapped in double underscores. Categories and supplied text must be nonempty. Every stage requires text and/or media. Questions have no configurable point value.

All content uses the existing stage schema: text, media, or both. General-clue content uses the shared question-stage renderer: images sit beside the text on desktop and above it on narrow screens, matching regular text questions. Media paths are relative to the pack's `media/` folder and use the usual image, audio, and video extensions. Media-only stages are supported. The builder preserves authored media and configuration through export and re-import.

The question editor places the general clue on the left and the answer hint and stages on the right, with paid clues underneath. Questions and paid clues can be reordered by dragging their handles or using Space and arrow keys. Reordering preserves each paid clue's ID, content, category, and price. Saved drafts from the earlier clues editor are converted to stage fields without changing their configured budgets. Pack imports require the stage-based format above.

Only the currently presented question in an active round accepts purchases. One server transaction debits the team's round balance and records the purchased clue. Duplicate requests and simultaneous purchases of the same clue charge once. Spending the last coins succeeds; insufficient funds leave both the clue and balance unchanged. Teammates share purchases, including after navigation or reconnecting.

The host sees every clue while presenting a question, including during the active round. After closure, the host can show/hide all clues or individual clues independently of the answer. These public reveals reset when changing questions. Hiding a public clue leaves it readable to teams that purchased it. Reveals never spend coins or change purchases. Revealed answers use the shared question-stage overlay, above the general clue and paid clues, for text, media, loading, and error states. The overlay stays within the visible stage while the question content scrolls. General-clue audio/video pauses when the revealed answer has its own media. Purchase updates preserve current playback, including clips already purchased by the team. Closing the round freezes answers and purchases; players' active answer tab disappears, while the host can continue presenting questions and revealing clues and answers.

## Access and deployment

Question documents contain the public general-clue stage and only the IDs, categories, and prices of paid clues. Complete definitions live in question subcollections readable by the host. Once a clues round is closed, room members can read any individual clue definition, including unshown clues and clues from other questions. Active-round definitions remain host-only. Collection listing is restricted to the host. The UI shows only purchased clues and clues the host has revealed. Server-owned balances and purchased content live at `rooms/{room}/cluePurchases/{team}/rounds/{round}`, outside the writable team-round namespace. Teams can read their own purchase records; clients, including the host, cannot write them directly.

The UI subscribes directly to Firestore for balances and purchased content, host definitions, and individual publicly revealed clues. Purchases use an authenticated server transaction; no content refresh endpoint is needed. All clue media uses the ordinary `rooms/{room}/media/` Storage path, uploader, and shared Firebase download flow. Readable responses are cached as blobs; when browser policy blocks script access, native image/audio/video elements use the download URL directly. HTTP errors and media-element failures remain visible, and a failed asset does not block other clues. Room members can fetch an asset directly if they know its path, even without buying its clue. The UI still shows clue content only after purchase or host reveal. Clients cannot upload or overwrite room media.

Deploy the complete repository rules files. The `cluePurchases` match belongs directly under `/rooms/{roomId}`, alongside `teams`, rather than inside `teams`. The closed-round clue read match belongs under `/rounds/{roundId}/questions/{questionId}/clues/{clueId}`. Incorrect nesting denies player reads even for text-only clues. Existing rooms in the stage-based format need no Firestore migration. Previously uploaded assets in the retired private clue namespace are not moved automatically; re-provision those packs to use the ordinary media path.

Deploy both `firestore.rules` and `storage.rules` before enabling clues in production:

```sh
firebase deploy --only firestore:rules,storage
```

Storage rules permit owners to stage pack uploads and room members to read ordinary presentation media. Storage membership checks use the default Firestore database and require the Firebase Storage rules service to have access to it. CI exercises these rules with local emulators; it does not deploy rules.

Run the purchase/privacy integration tests against a built app:

```sh
npm run build
firebase emulators:exec --only firestore,auth,storage --project demo-quizee-drafts "npm run test:rules && npm run test:clues:http"
```
