import { expect, request as playwrightRequest, test, type APIRequestContext } from "@playwright/test";
import { signUpAndLogIn, uniqueName } from "./helpers";

// Local requests carry no client IP, so per-IP limits are skipped there. These
// tests send a made-up public address (from 198.18.0.0/15, reserved for tests),
// random per run so counters left in a local database don't collide.
function testIp() {
  const part = () => Math.floor(Math.random() * 254) + 1;
  return `198.18.${part()}.${part()}`;
}

async function attemptLogin(client: APIRequestContext, email: string, password: string) {
  const response = await client.post("/api/auth/login", { form: { email, password, next: "/" }, maxRedirects: 0 });
  return response.headers().location ?? "";
}

test("five wrong passwords lock the account for a while", async ({ page, browser, baseURL }) => {
  const { email, password } = await signUpAndLogIn(page, "E2E lockout");
  const client = await playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": testIp() } });

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    expect(await attemptLogin(client, email, "wrong-password"), `attempt ${attempt}`).toContain("error=invalid");
  }
  // Even the right password is refused until the window passes.
  expect(await attemptLogin(client, email, password)).toContain("error=rate-limited");
  await client.dispose();

  // The login page shows the wait; a signed-out browser is needed to see it.
  const visitor = await browser.newPage({ baseURL });
  await visitor.goto("/login?error=rate-limited&retry=600");
  await expect(visitor.getByText("Too many sign-in attempts. Try again in 10 minutes.")).toBeVisible();
  await visitor.close();
});

test("a successful login clears the failed-attempt count", async ({ page, baseURL }) => {
  const { email, password } = await signUpAndLogIn(page, "E2E reset count");
  const client = await playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": testIp() } });

  for (let round = 1; round <= 2; round += 1) {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect(await attemptLogin(client, email, "wrong-password")).toContain("error=invalid");
    }
    expect(await attemptLogin(client, email, password), `round ${round}`).not.toContain("error=");
  }
  await client.dispose();
});

test("invitations answer 429 with a clear message after 30 in an hour", async ({ page }) => {
  await signUpAndLogIn(page, "E2E invite limit");
  const project = (await (await page.request.post("/api/projects", { data: { name: uniqueName("E2E limits") } })).json()) as { id: string };

  for (let invite = 1; invite <= 30; invite += 1) {
    const response = await page.request.post(`/api/projects/${project.id}/invitations`, {
      data: { email: `e2e-limit-${invite}-${Date.now()}@example.test`, role: "VIEWER" },
    });
    expect(response.status(), `invitation ${invite}`).toBe(201);
  }

  const blocked = await page.request.post(`/api/projects/${project.id}/invitations`, {
    data: { email: `e2e-limit-over-${Date.now()}@example.test`, role: "VIEWER" },
  });
  expect(blocked.status()).toBe(429);
  expect(Number(blocked.headers()["retry-after"])).toBeGreaterThan(0);
  expect((await blocked.json()).error).toMatch(/^Too many invitations\. Try again in \d+ minutes?\.$/);
});
