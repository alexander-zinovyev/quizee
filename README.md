## Quizee

Realtime quiz stage + chat experiments powered by Next.js and Firebase.

## Local development

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`.

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
