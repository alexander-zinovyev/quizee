## Quizee

Realtime quiz stage + chat experiments powered by Next.js and Firebase.

## Local development

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`.

## Color rounds

The builder supports `color` rounds. For raster questions, select a static PNG, JPEG, or WebP image and
a grayscale mask with identical dimensions (at most 16 megapixels). White mask
pixels are recolored, black pixels are preserved, and gray edges are blended.
Enter six-digit HEX initial and target colors and choose threshold or closest
scoring. Prepare masks in an external image editor.

```json
[
  {
    "type": "color",
    "title": "True Colors",
    "scoring": { "mode": "threshold", "threshold": 8.5, "points": 1 },
    "questions": [
      {
        "image": "logo.png",
        "mask": "logo-mask.png",
        "initialColor": "#83C547",
        "targetColor": "#4285F4"
      }
    ]
  }
]
```

Players edit HSV controls in the presenting view. Teams share automatically
saved HEX answers; slider changes preview locally and are saved when dragging
ends or a keyboard adjustment finishes. Canceled drags are discarded, and
unchanged colors create no writes. The lock button beside the sliders locks the
question's answer for the whole team; any teammate can unlock it while the question
is active. Locking preserves the selected color, including untouched initial colors.
Untouched answers use the initial color. Hosts see live team
images during the round and the correct image after closure. Players see the
correct image with a left-to-right page-turn-style wipe when the host selects Show answer.
After closure, sliders are hidden and each team sees its frozen submission until
reveal. Hover over the revealed image for a split comparison: the left half shows
the submission and the right half shows the correct image. Image indicators label
the submission "Team" at the top left and the correct version "Original" at the
top right. Touch users can hold the image, and keyboard users can focus it. Sliders are horizontal below the
image during the round. Reduced-motion preferences disable the reveal animation.
Revealed questions show the team's similarity score out of 10 and awarded points.

SVG color questions use one file and a nonempty array of unique region IDs instead
of a mask:

```json
{
  "image": "logo.svg",
  "regionIds": ["lettering", "symbol"],
  "initialColor": "#83C547",
  "targetColor": "#4285F4"
}
```

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60">
  <g id="lettering" fill="#4285F4">
    <rect x="10" y="10" width="20" height="40" />
    <rect x="40" y="10" width="20" height="40" />
  </g>
  <circle id="symbol" cx="95" cy="30" r="20" fill="#4285F4" />
</svg>
```

The builder provides editable dropdown rows with add/remove controls and previews all selected regions
with the same color. Existing raster packs remain supported. SVGs require a valid
`viewBox`, or positive numeric/px `width` and `height` from which a `viewBox` can be
inferred. Editable regions must have author-supplied IDs. The importer does not
create region IDs for unnamed shapes. Regions can be static shapes or groups with
flat, opaque fills, or stroke-only shapes/groups with one opaque stroke color.
Filled regions retain their existing outlines when recolored.
Presentation attributes and inline `style` declarations support `fill`, `fill-rule`,
`fill-opacity`, `stroke`, `stroke-width`, `stroke-opacity`, `stroke-linecap`,
`stroke-linejoin`, `stroke-miterlimit`, `stroke-dasharray`, `stroke-dashoffset`,
`opacity`, `clip-path`, `clip-rule`, `stop-color`, `stop-opacity`, `color`,
`paint-order`, and `overflow`. The displayed image is clipped to its root viewport,
as with an external SVG image, so it cannot overlap neighboring controls.
`currentColor` inherits the SVG's own color rather
than the app theme. Inline styles
are normalized to attributes, preserving declaration order and `!important`
precedence, so region recoloring still works. Unsupported style properties and
malformed values are refused. `xml:space` and the editor-only declaration
`-inkscape-stroke:none` are accepted and discarded. Convert visible text to paths.
Static local gradients and clipping paths are supported outside editable regions.
Local `<use href="#id">` and `<use xlink:href="#id">` references to shapes or groups
are expanded into independent copies; give each editable `use` instance (or its
containing group) its own ID. Cyclic, missing, or external references are refused.
Embedded `<style>`
blocks, CSS variables, scripts, animation, embedded images, external references, and
document types are refused. IDs must start with a letter or underscore and contain
only letters, digits, underscores, dots, colons, and hyphens. SVG files are limited
to 1 MiB, 5,000 elements, and a nesting depth of 64, including expanded copies.

Similarity is `10 * exp(-CIEDE2000 / 18)`. Threshold mode awards points when the
unrounded score meets the threshold. Closest mode splits the point pool equally
between teams within `tieTolerance` of the best score (default `0.05`).

## Firebase setup

1. Create a Firebase project and enable Cloud Firestore.
2. Register a web app in the Firebase console and copy the client config into your `.env.local`:

```
NEXT_PUBLIC_FIREBASE_API_KEY="..."
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="..."
NEXT_PUBLIC_FIREBASE_PROJECT_ID="..."
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="..."
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="..."
NEXT_PUBLIC_FIREBASE_APP_ID="..."
```

3. Generate a service-account key (Project Settings → Service accounts) and add the admin credentials:

```
FIREBASE_PROJECT_ID="..."
FIREBASE_CLIENT_EMAIL="firebase-adminsdk@project.iam.gserviceaccount.com"
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Remember to keep `\n` escaped when storing multi-line keys in `.env`.

4. Seed at least one room document so the join endpoint has something to validate against:

```
rooms/{roomSlug} {
  title: "Cipher Relay",
  password: "secret-code" // replace with your password policy
}
```

You can configure the default slug when no room is provided by setting:

```
FIREBASE_DEFAULT_ROOM="demo-room"
```

Join requests are stored under `rooms/{roomSlug}/joinRequests`, so the host can review them in the console or subscribe in realtime later. Replace the placeholder password handling with a proper hash + auth strategy before running a production game.

## Data model (rooms)

- `rooms/{roomId}` – room metadata (e.g., `title`, `createdAt`).
- `rooms/{roomId}/auth/{docId}` – password settings for the room.
- `rooms/{roomId}/members/{uid}` – membership record with `role` (`host`/`player`), `joinedAt`, and `team` (null until assigned or host).
- `rooms/{roomId}/teams/{teamId}` – each team has `name` and optional styling/metadata you add later. Reference the `teamId` from `members/{uid}.team`.

## Double or nothing

Text rounds can set `"allowWager": true` in `quiz.json`, or enable **Double or
nothing** in the builder. The option defaults to false and is supported only on
text rounds. Each team gets an **x2** toggle per answer in enabled rounds.
Teammates can change it while the round is active, independently of answer text
or locking, including for blank answers.

When the host closes the round, wagered answers start at **−2** in grading. The
correct-answer shortcut awards **+2**, and the incorrect-answer shortcut restores
**−2**. Other answers keep the existing **+1 / 0** shortcuts. Hosts can override
awarded points manually. Negative scores carry through round totals, standings,
and score breakdowns.
