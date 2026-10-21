import "dotenv/config";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { signUpAndLogIn } from "./helpers";

const SESSION_COOKIE = "ai_multi_task_session";
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

test("the database keeps only a fingerprint of each session token", async ({ page, browser, baseURL }) => {
  await signUpAndLogIn(page, "E2E session");
  const cookie = (await page.context().cookies()).find((item) => item.name === SESSION_COOKIE);
  expect(cookie?.value).toBeTruthy();
  const token = cookie!.value;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    expect((await pool.query('SELECT 1 FROM "Session" WHERE token = $1', [token])).rowCount).toBe(0);
    const stored = await pool.query<{ token: string }>('SELECT token FROM "Session" WHERE token = $1', [sha256(token)]);
    expect(stored.rowCount).toBe(1);

    // Someone with a copy of the database can't log in with what's stored there.
    const intruder = await browser.newContext({ baseURL });
    await intruder.addCookies([{ name: SESSION_COOKIE, value: stored.rows[0].token, url: baseURL! }]);
    expect((await intruder.request.get("/api/projects")).status()).toBe(401);
    await intruder.close();

    // The real cookie still works, and logging out deletes the session.
    expect((await page.request.get("/api/projects")).status()).toBe(200);
    await page.request.post("/api/auth/logout", { maxRedirects: 0 });
    expect((await pool.query('SELECT 1 FROM "Session" WHERE token = $1', [sha256(token)])).rowCount).toBe(0);
    expect((await page.request.get("/api/projects")).status()).toBe(401);
  } finally {
    await pool.end();
  }
});
