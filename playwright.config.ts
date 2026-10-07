import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3017", screenshot: "only-on-failure" },
  webServer: {
    command: "npm run dev -- --port 3017",
    url: "http://127.0.0.1:3017/build",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      QUIZEE_NEXT_DIST_DIR: ".next-color",
      NEXT_PUBLIC_FIREBASE_API_KEY: "browser-test-key",
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-quizee.firebaseapp.com",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-quizee",
      NEXT_PUBLIC_FIREBASE_APP_ID: "browser-test-app",
    },
  },
});
