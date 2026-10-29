import { expect, test } from "@playwright/test";

test("public and login pages never start anonymous gameplay authentication", async ({ page }) => {
  const anonymousRequests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("accounts:signUp")) anonymousRequests.push(request.url()); });
  await page.goto("/");
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  expect(anonymousRequests).toEqual([]);
});

test("signed-in non-admins see their access state without administration data", async ({ page }) => {
  await page.route("**/api/auth/admin/session", (route) => route.fulfill({ json: { uid: "test-google-user", email: "person@example.com", displayName: "Person", admin: false } }));
  await page.goto("/login");
  await expect(page.getByText("Your account is awaiting administrator access.")).toBeVisible();
  await expect(page.getByText("Account UID: test-google-user")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open administration" })).toHaveCount(0);
});

test("unauthenticated administrator pages redirect to login", async ({ page }) => {
  await page.goto("/stats/admin/users");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
});
