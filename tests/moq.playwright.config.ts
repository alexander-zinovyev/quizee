import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./moq",
  testMatch: "*.spec.ts",
  timeout: 90000,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "../test-results/moq-results.json" }]],
  use: {
    baseURL: "http://127.0.0.1:3029",
    screenshot: "only-on-failure",
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required", "--host-resolver-rules=MAP localhost 127.0.0.1"] },
  },
  webServer: [
    { command: "node tests/moq/relay.mjs", cwd: "..", wait: { stderr: /listening.*4443/ }, timeout: 120000 },
    { command: "node tests/moq/server.mjs", cwd: "..", wait: { stdout: /MoQ fixture ready/ }, timeout: 30000 },
  ],
});
