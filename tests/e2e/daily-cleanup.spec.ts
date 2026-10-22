import "dotenv/config";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";

// Prisma's timestamps are UTC "timestamp without time zone" columns.
const UTC_NOW = `(now() AT TIME ZONE 'utc')`;
const LOCAL_UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "project-chat");

test("the daily cleanup deletes only what nobody can use any more (#132)", async ({ request }) => {
  const run = randomUUID().slice(0, 8);
  const id = (name: string) => `e2e-cleanup-${run}-${name}`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const files: string[] = [];
  const sql = (text: string, values: unknown[] = []) => pool.query(text, values);
  const exists = async (table: string, column: string, value: string) =>
    ((await sql(`SELECT 1 FROM "${table}" WHERE "${column}" = $1`, [value])).rowCount ?? 0) > 0;

  const addUser = (name: string, isGuest: boolean, daysOld: number) =>
    sql(
      `INSERT INTO "User" (id, email, name, "isGuest", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, ${UTC_NOW} - make_interval(days => $5), ${UTC_NOW})`,
      [id(name), `${id(name)}@example.test`, name, isGuest, daysOld],
    );
  // Session lifetimes are relative to now, in days (negative: already expired).
  const addSession = (name: string, user: string, expiresInDays: number) =>
    sql(
      `INSERT INTO "Session" (id, token, "userId", "expiresAt") VALUES ($1, $2, $3, ${UTC_NOW} + make_interval(days => $4))`,
      [id(name), id(`${name}-token`), id(user), expiresInDays],
    );
  const addResetToken = (name: string, user: string, expiresInHours: number, used: boolean) =>
    sql(
      `INSERT INTO "PasswordResetToken" (id, "userId", "tokenHash", "expiresAt", "usedAt")
       VALUES ($1, $2, $3, ${UTC_NOW} + make_interval(hours => $4), ${used ? UTC_NOW : "NULL"})`,
      [id(name), id(user), id(`${name}-hash`), expiresInHours],
    );
  const addVerificationToken = (name: string, user: string, expiresInHours: number) =>
    sql(
      `INSERT INTO "EmailVerificationToken" (id, "userId", "tokenHash", "expiresAt")
       VALUES ($1, $2, $3, ${UTC_NOW} + make_interval(hours => $4))`,
      [id(name), id(user), id(`${name}-hash`), expiresInHours],
    );
  const addProject = (name: string, owner: string) =>
    sql(`INSERT INTO "Project" (id, name, "userId", "updatedAt") VALUES ($1, $2, $3, ${UTC_NOW})`, [id(name), name, id(owner)]);

  try {
    // A guest from 40 days ago whose session expired: nobody can open it again.
    await addUser("old-guest", true, 40);
    await addSession("old-guest-session", "old-guest", -33);
    await addProject("old-guest-project", "old-guest");
    await sql(
      `INSERT INTO "Task" (id, title, "userId", "projectId", "updatedAt") VALUES ($1, 'Guest task', $2, $3, ${UTC_NOW})`,
      [id("old-guest-task"), id("old-guest"), id("old-guest-project")],
    );
    // Pending chat uploads with a file on disk (expiry in hours from now).
    mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });
    const addUpload = async (name: string, project: string, user: string, expiresInHours: number) => {
      const storageKey = `${id(name)}.txt`;
      writeFileSync(path.join(LOCAL_UPLOAD_DIR, storageKey), name);
      files.push(path.join(LOCAL_UPLOAD_DIR, storageKey));
      await sql(
        `INSERT INTO "ProjectChatAttachmentUpload"
           (id, "projectId", "userId", "fileName", "originalName", "fileType", "fileSize", url, "storageProvider", "storageKey", "expiresAt")
         VALUES ($1, $2, $3, $4, 'notes.txt', 'text/plain', 10, $5, 'LOCAL', $4, ${UTC_NOW} + make_interval(hours => $6))`,
        [id(name), id(project), id(user), storageKey, `/uploads/project-chat/${storageKey}`, expiresInHours],
      );
      return path.join(LOCAL_UPLOAD_DIR, storageKey);
    };
    // The guest's file goes with the guest, even though its upload hasn't expired.
    const guestFile = await addUpload("guest-upload", "old-guest-project", "old-guest", 1);

    // Guests that stay: one is new, one still has a valid session, one is in a real user's project.
    await addUser("new-guest", true, 2);
    await addSession("new-guest-session", "new-guest", 5);
    await addUser("signed-in-guest", true, 40);
    await addSession("signed-in-guest-session", "signed-in-guest", 2);
    await addUser("shared-guest", true, 40);
    await addSession("shared-guest-session", "shared-guest", -33);

    // A real user: expired and used things go, the rest stays.
    await addUser("member", false, 90);
    await addSession("member-expired-session", "member", -1);
    await addSession("member-session", "member", 3);
    await addResetToken("used-token", "member", 1, true);
    await addResetToken("expired-token", "member", -1, false);
    await addResetToken("live-token", "member", 1, false);
    await addVerificationToken("expired-confirmation", "member", -1);
    await addVerificationToken("live-confirmation", "member", 1);
    for (const [name, daysOld] of [["old-notification", 91], ["recent-notification", 89]] as const) {
      await sql(
        `INSERT INTO "Notification" (id, "userId", type, title, "createdAt") VALUES ($1, $2, 'MENTION', 'Hi', ${UTC_NOW} - make_interval(days => $3))`,
        [id(name), id("member"), daysOld],
      );
    }
    await addProject("member-project", "member");
    await sql(
      `INSERT INTO "ProjectMember" (id, "projectId", "userId", name, role, "updatedAt") VALUES ($1, $2, $3, 'Guest helper', 'EDITOR', ${UTC_NOW})`,
      [id("shared-membership"), id("member-project"), id("shared-guest")],
    );
    // An upload that expired two hours ago (past the one-hour grace) is removed; a pending one stays.
    const expiredFile = await addUpload("expired-upload", "member-project", "member", -2);
    const pendingFile = await addUpload("pending-upload", "member-project", "member", 1);

    await sql(
      `INSERT INTO "RateLimit" (key, "window", count, "expiresAt") VALUES ($1, 1, 1, now() - interval '1 minute'), ($2, 1, 1, now() + interval '1 hour')`,
      [id("rate-expired"), id("rate-live")],
    );

    const response = await request.get("/api/cron/cleanup");
    expect(response.ok(), await response.text()).toBe(true);
    const result = (await response.json()) as Record<string, number>;
    expect(result.guests).toBeGreaterThanOrEqual(1);
    expect(result.uploads).toBeGreaterThanOrEqual(1);

    // Deleted, with what cascades from them.
    expect(await exists("User", "id", id("old-guest"))).toBe(false);
    expect(await exists("Project", "id", id("old-guest-project"))).toBe(false);
    expect(await exists("Task", "id", id("old-guest-task"))).toBe(false);
    expect(await exists("ProjectChatAttachmentUpload", "id", id("guest-upload"))).toBe(false);
    expect(existsSync(guestFile)).toBe(false);
    expect(await exists("ProjectChatAttachmentUpload", "id", id("expired-upload"))).toBe(false);
    expect(existsSync(expiredFile)).toBe(false);
    for (const name of ["member-expired-session", "old-guest-session", "shared-guest-session"]) {
      expect(await exists("Session", "id", id(name)), name).toBe(false);
    }
    expect(await exists("PasswordResetToken", "id", id("used-token"))).toBe(false);
    expect(await exists("PasswordResetToken", "id", id("expired-token"))).toBe(false);
    expect(await exists("EmailVerificationToken", "id", id("expired-confirmation"))).toBe(false);
    expect(await exists("Notification", "id", id("old-notification"))).toBe(false);
    expect(await exists("RateLimit", "key", id("rate-expired"))).toBe(false);

    // Kept.
    for (const name of ["new-guest", "signed-in-guest", "shared-guest", "member"]) {
      expect(await exists("User", "id", id(name)), name).toBe(true);
    }
    expect(await exists("ProjectMember", "id", id("shared-membership"))).toBe(true);
    expect(await exists("Session", "id", id("member-session"))).toBe(true);
    expect(await exists("PasswordResetToken", "id", id("live-token"))).toBe(true);
    expect(await exists("EmailVerificationToken", "id", id("live-confirmation"))).toBe(true);
    expect(await exists("Notification", "id", id("recent-notification"))).toBe(true);
    expect(await exists("RateLimit", "key", id("rate-live"))).toBe(true);
    expect(await exists("ProjectChatAttachmentUpload", "id", id("pending-upload"))).toBe(true);
    expect(existsSync(pendingFile)).toBe(true);

    // Running it again changes nothing that is still in use.
    expect((await request.get("/api/cron/cleanup")).ok()).toBe(true);
    expect(await exists("User", "id", id("shared-guest"))).toBe(true);
    expect(await exists("Session", "id", id("member-session"))).toBe(true);
  } finally {
    for (const file of files) rmSync(file, { force: true });
    await sql(`DELETE FROM "RateLimit" WHERE key LIKE $1`, [`e2e-cleanup-${run}-%`]);
    await sql(`DELETE FROM "User" WHERE id LIKE $1`, [`e2e-cleanup-${run}-%`]);
    await pool.end();
  }
});
