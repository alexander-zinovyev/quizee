import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:3018";
export default defineConfig({
  testDir: "./stats-browser", workers: 1, timeout: 120000,
  use: { baseURL, screenshot: "only-on-failure" },
  webServer: {
    command: "npm run dev -- --port 3018", url: `${baseURL}/login`, reuseExistingServer: !process.env.CI, timeout: 120000,
    env: { QUIZEE_NEXT_DIST_DIR: ".next-stats", FIREBASE_PROJECT_ID: "demo-quizee-drafts", QUIZEE_STATISTICS_PUBLIC_ENABLED: "true",
      NEXT_PUBLIC_FIREBASE_API_KEY: "fake", NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-quizee-drafts",
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-quizee-drafts.firebaseapp.com", NEXT_PUBLIC_FIREBASE_APP_ID: "stats-browser-test" },
  },
});
