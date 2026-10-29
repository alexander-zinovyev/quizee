# Statistics administrator setup

Administrator sign-in uses Google in the same Firebase project as gameplay. Its named client app and `__stats_admin` session cookie are separate from gameplay's anonymous auth and `__session` cookie. Signing in does not grant an administrator role.

## Firebase project configuration

1. In Firebase Console, open Authentication, Sign-in method, and enable Google. Select the project's support email and save.
2. Under Authentication, Settings, Authorized domains, add the exact application hostname used for testing. Include `localhost` for local testing if it is not already present. Each Vercel preview hostname used for real Google sign-in must be authorized.
3. Keep the existing Firebase client and Admin SDK environment configuration. This feature needs no separately supplied Google client secret.

See [Firebase's Google sign-in setup](https://firebase.google.com/docs/auth/web/google-signin). Emulator Google credentials and session-cookie verification are test-only; see [Firebase Auth emulator behavior](https://firebase.google.com/docs/emulator-suite/connect_auth).

## First administrator

1. Open `/login` on the configured deployment and sign in with the intended Google account.
2. The pending-access screen displays the account UID. Verify the account's email before selecting this UID.
3. From an operator checkout configured for that same Firebase project, run:

   ```sh
   node --import tsx scripts/bootstrap-stats-admin.ts <existing-google-uid>
   ```

   The script loads `.env.local` and `.env`. It requires the existing `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` configuration and sufficient Firestore/Auth access. It checks the existing Google account and signed-in directory record. Role assignment, administrator count, and audit event commit together.
4. Use **Check access again** on `/login`, then open administration.

Bootstrap refuses to run after initialization. Later grants and revocations use `/stats/admin/users`: search an exact signed-in account UID or email, inspect the account, and confirm the change. The last administrator cannot be revoked. Revocations take effect on the next authorized request.

Before deployment, check for historical rooms with IDs `login` or `stats`; these names now belong to static application routes. New room creation reserves them using the same validation on client and server.

## Local verification

```sh
npm run test:stats
npx playwright test tests/browser/stats-auth.spec.ts
npx --yes firebase-tools@14.12.0 emulators:exec --only firestore,auth --project demo-quizee-drafts 'npm run test:rules && npm run test:stats:firestore && npm run test:stats:auth'
```

The Firestore emulator requires Java; the application does not. Emulator tests use a demo project and never require production credentials or provider configuration. CI installs Java and runs these tests on pushes, pull requests, and nightly.
