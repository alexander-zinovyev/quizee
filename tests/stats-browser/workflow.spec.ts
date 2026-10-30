import { test, expect, request as requestFactory } from "@playwright/test";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { initializeApp as initializeClient, deleteApp as deleteClient } from "firebase/app";
import { connectAuthEmulator, getAuth as getClientAuth, GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { bootstrapStatsAdmin } from "../../server/stats/roles";
import { roomSourceFixture, sourceFixtureDocuments } from "../../server/stats/source.fixtures";
import { ADMIN_SESSION_COOKIE } from "../../server/stats/sessions";
import { statsPaths, STATS_ROOT } from "../../server/stats/model";

const baseURL = "http://127.0.0.1:3018", gameId = "browser-statistics", projectId = "demo-quizee-drafts";
let app: ReturnType<typeof initializeApp>, clientApp: ReturnType<typeof initializeClient>, db: ReturnType<typeof getFirestore>, actorId: string, cookie: string;

test.beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error("Run stats browser tests inside both emulators.");
  app = initializeApp({ projectId }, "stats-browser"); db = getFirestore(app);
  clientApp = initializeClient({ projectId, apiKey: "fake" }, "stats-browser-login");
  const auth = getClientAuth(clientApp); connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const user = (await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: "stats-browser-admin", email: "stats-browser@example.com", email_verified: true, name: "Browser administrator" })))).user;
  actorId = user.uid;
  const api = await requestFactory.newContext({ baseURL });
  try {
    const response = await api.post("/api/auth/admin/session", { headers: { Origin: baseURL }, data: { idToken: await user.getIdToken() } });
    expect(response.ok(), await response.text()).toBeTruthy();
    cookie = (await api.storageState()).cookies.find((item) => item.name === ADMIN_SESSION_COOKIE)!.value;
    await bootstrapStatsAdmin(db, getAuth(app), actorId);
  } finally { await api.dispose(); }
  const source = roomSourceFixture(4, 2, gameId); source.rounds[0].data.gradingRequired = true;
  const batch = db.batch(); sourceFixtureDocuments(source).forEach(({ path, data }) => batch.set(db.doc(path), data)); await batch.commit();
});

test.afterAll(async () => {
  if (!db) return;
  await db.recursiveDelete(db.doc(`rooms/${gameId}`)); await db.recursiveDelete(db.doc(statsPaths.game(gameId)));
  const people = await db.collection(`${STATS_ROOT}/people`).get(); for (const person of people.docs) await db.recursiveDelete(person.ref);
  const audit = await db.collection(`${STATS_ROOT}/audit`).get(); const cleanup = db.batch(); audit.docs.forEach((event) => cleanup.delete(event.ref)); cleanup.delete(db.doc(`roles/${actorId}`)); cleanup.delete(db.doc(`users/${actorId}`)); cleanup.delete(db.doc("roles/_state")); await cleanup.commit();
  if (actorId) await getAuth(app).deleteUser(actorId);
  await deleteClient(clientApp); await db.terminate(); await deleteApp(app);
});

test("review, partial identity mapping, provisional publication, public views, and frozen corrections", async ({ page, context }) => {
  // Exercise missing historical media without contacting a real Storage bucket.
  await context.route("**/api/stats/**/assets/**", (route) => route.fulfill({ status: 404, body: "Historical media unavailable" }));
  await context.addCookies([{ name: ADMIN_SESSION_COOKIE, value: cookie, url: baseURL, httpOnly: true, sameSite: "Strict" }]);
  await page.goto(`/stats/admin/games/${gameId}`);
  await page.getByRole("button", { name: "Create snapshot", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Player identities" })).toBeVisible();
  await page.getByLabel("Completion date (UTC)", { exact: true }).fill("2026-10-29");
  await page.getByLabel("Pack label", { exact: true }).fill("Autumn quiz");
  await page.getByRole("button", { name: "Link red player 0", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Link a person" });
  await dialog.getByText("Create a new person and link", { exact: true }).click();
  await dialog.getByLabel("Display name", { exact: true }).fill("Alice");
  await dialog.getByLabel("Private notes", { exact: true }).fill("PRIVATE matching note");
  await dialog.getByRole("button", { name: "Create and link", exact: true }).click();
  await page.getByRole("button", { name: "Link host", exact: true }).click();
  await dialog.getByText("Create a new person and link", { exact: true }).click();
  await dialog.getByLabel("Display name", { exact: true }).fill("Quizmaster");
  await dialog.getByRole("button", { name: "Create and link", exact: true }).click();
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Review saved.");
  await expect(page.getByRole("button", { name: "Publish game", exact: true })).toBeDisabled();
  await page.getByLabel(/I acknowledge incomplete grading/).check();
  await page.getByRole("button", { name: "Publish game", exact: true }).click();
  await expect(page.getByRole("link", { name: "View published game", exact: true })).toBeVisible();
  const records = await db.collection(`${STATS_ROOT}/people`).get(), aliceId = records.docs.find((person) => person.data().displayName === "Alice")!.id;
  const publicResponse = await page.request.get(`/api/stats/games/${gameId}`); expect(publicResponse.ok()).toBeTruthy();
  const publicGame = await publicResponse.json(); expect(JSON.stringify(publicGame)).not.toContain("PRIVATE");
  await page.goto("/stats"); await expect(page.getByRole("heading", { name: "Game statistics", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Alice", exact: true })).toBeVisible();
  await page.goto("/stats?playersSort=wins&playersDirection=asc");
  const dateHeading = page.getByRole("columnheader", { name: /Date \(UTC\)/ });
  await dateHeading.getByRole("link").focus(); await page.keyboard.press("Enter");
  await expect(dateHeading).toHaveAttribute("aria-sort", "ascending");
  expect(new URL(page.url()).searchParams.get("playersSort")).toBe("wins");
  const rosterButton = page.getByRole("button", { name: "View roster", exact: true });
  await rosterButton.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Hide roster", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("red player 1 (unresolved)", { exact: false })).toBeVisible();
  await page.goto(`/stats/games/${gameId}`); await expect(page.getByText(/Grading was incomplete when these scores were published/)).toBeVisible();
  await page.getByRole("button", { name: "Show questions and answers", exact: true }).first().click();
  await expect(page.getByText("Correctness unavailable", { exact: true }).first()).toBeVisible();
  for (let index = 1; index < 4; index++) {
    const round = page.getByRole("article").filter({ has: page.getByRole("heading", { name: `Round ${index + 1}`, exact: true }) });
    await round.getByRole("button", { name: "Show questions and answers", exact: true }).click();
    await expect(round.getByRole("table")).toBeVisible();
    if (index === 1) await expect(round.getByText("Media unavailable", { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Hide questions", exact: true })).toHaveCount(1);
  await page.screenshot({ path: "test-results/stats-game-desktop.png" });
  await db.doc(`rooms/${gameId}/teams/red`).update({ scoreTotal: 99999 });
  await page.reload(); await expect(page.getByText("99,999", { exact: false })).toHaveCount(0);
  await page.goto(`/stats/admin/games/${gameId}`); await page.getByText("Round 1 (text)", { exact: true }).click();
  await page.getByRole("spinbutton", { name: "Maximum for Round 1, question 1", exact: true }).fill("2");
  await page.getByRole("button", { name: "Review correction", exact: true }).click();
  await expect(page.getByRole("region", { name: "Confirm correction" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm and save correction", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Review saved.");
  const corrected = await (await page.request.get(`/api/stats/games/${gameId}`)).json();
  expect(corrected.teams).toEqual(publicGame.teams);
  await page.goto(`/stats/players/${aliceId}`); await expect(page.getByRole("heading", { name: "Alice", exact: true })).toBeVisible();
  await expect(page.getByText("PRIVATE", { exact: false })).toHaveCount(0);
  await page.goto(`/stats/hosts/${publicGame.host.personId}`);
  await expect(page.getByRole("heading", { name: "Quizmaster", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`/stats/games/${gameId}`);
  await expect(page.getByRole("heading", { name: "Final results", exact: true })).toBeVisible();
  expect(await page.locator("body").evaluate((element) => element.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: "test-results/stats-game-mobile.png" });
});
