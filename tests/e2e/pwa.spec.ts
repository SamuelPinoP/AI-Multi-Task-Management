import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { signUpAndLogIn, uniqueName } from "./helpers";

// SMART-10: the installable app and offline reading.

/**
 * Fetches a file signed out and checks it wasn't swapped for the login page.
 * Redirects are followed: on Vercel previews the protection bypass answers
 * the first request with a redirect that sets its cookie.
 */
async function getSignedOut(request: APIRequestContext, path: string) {
  const response = await request.get(path);
  expect.soft(new URL(response.url()).pathname, path).toBe(path);
  expect.soft(response.status(), path).toBe(200);
  return response;
}

test("the manifest, icons and service worker load signed out", { tag: "@smoke" }, async ({ request }) => {
  const manifestResponse = await getSignedOut(request, "/manifest.webmanifest");
  const manifest = (await manifestResponse.json()) as {
    name: string;
    display: string;
    start_url: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };
  expect(manifest).toMatchObject({ name: "AI Multi", display: "standalone", start_url: "/" });
  // Chrome's install criteria: a 192px and a 512px icon. Android also wants a maskable one.
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);

  for (const src of [...manifest.icons.map((icon) => icon.src), "/icons/apple-touch-icon.png"]) {
    const icon = await getSignedOut(request, src);
    expect.soft(icon.headers()["content-type"], src).toBe("image/png");
  }

  const worker = await getSignedOut(request, "/sw.js");
  expect(worker.headers()["content-type"]).toContain("javascript");
  expect(worker.headers()["cache-control"]).toContain("no-cache");
});

test("pages link the manifest and the iPhone icon", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/login");
  // Vercel previews render the manifest link twice (both with crossorigin="use-credentials"); either works.
  await expect(page.locator('link[rel="manifest"]').first()).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('link[rel="apple-touch-icon"]').first()).toHaveAttribute("href", "/icons/apple-touch-icon.png");
});

test.describe("offline reading", () => {
  test.use({ serviceWorkers: "allow" });
  test.skip(process.env.E2E_SERVER_MODE !== "start", "The service worker registers in production builds only.");

  async function savedCacheNames(page: Page) {
    return page.evaluate(async () => (await caches.keys()).filter((name) => name.startsWith("ai-multi-user-")));
  }

  test("opened pages stay readable offline, and logging out deletes them", async ({ page, context }) => {
    await signUpAndLogIn(page, "Offline");
    const title = uniqueName("Read me offline");
    expect((await page.request.post("/api/tasks", { data: { title } })).status()).toBe(201);

    await page.goto("/tasks");
    await expect(page.getByText(title)).toBeVisible();
    // The first page loads before the worker takes over; it saves the page and its data afterwards.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const pages = await caches.open("ai-multi-user-pages");
          const api = await caches.open("ai-multi-user-api");
          return Boolean((await pages.match(location.href)) && (await api.keys()).some((request) => new URL(request.url).pathname === "/api/tasks"));
        }),
      )
      .toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText(title)).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "You're offline" })).toBeVisible();

    // A page never opened on this device gets the offline notice instead of a browser error.
    await page.goto("/goals");
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();

    await context.setOffline(false);
    await page.goto("/tasks");
    await expect(page.getByText(title)).toBeVisible();
    expect(await savedCacheNames(page)).not.toEqual([]);

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(await savedCacheNames(page)).toEqual([]);
  });
});
