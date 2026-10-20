import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupKey,
  backupKeysToDelete,
  isRecentBackup,
  orderTablesForRestore,
  parseBackup,
  quoteTable,
} from "./database-backup-core";

test("names backups by time so they sort oldest to newest", () => {
  assert.equal(backupKey(new Date("2026-10-20T07:00:01.234Z")), "backups/database/2026-10-20T07-00-01-234Z.json.gz");
  const keys = ["2026-10-01", "2026-10-03", "2026-10-02"].map((day) => backupKey(new Date(`${day}T07:00:00Z`)));
  assert.deepEqual(backupKeysToDelete(keys, 2), [backupKey(new Date("2026-10-01T07:00:00Z"))]);
  assert.deepEqual(backupKeysToDelete(keys, 5), []);
});

test("skips a second backup within 20 hours", () => {
  const now = new Date("2026-10-20T07:00:00Z");
  assert.equal(isRecentBackup(undefined, now), false);
  assert.equal(isRecentBackup(new Date("2026-10-20T00:00:00Z"), now), true);
  assert.equal(isRecentBackup(new Date("2026-10-19T07:00:00Z"), now), false);
});

test("restores parents before children and ignores self-references", () => {
  const order = orderTablesForRestore(
    ["TreeNode", "Task", "Project", "User", "TreePage", "ProjectMember"],
    [
      { child: "Task", parent: "Project" },
      { child: "Task", parent: "ProjectMember" },
      { child: "ProjectMember", parent: "Project" },
      { child: "ProjectMember", parent: "User" },
      { child: "Project", parent: "User" },
      { child: "TreePage", parent: "User" },
      { child: "TreeNode", parent: "TreePage" },
      { child: "TreeNode", parent: "TreeNode" },
      { child: "Session", parent: "User" },
    ],
  );
  const before = (a: string, b: string) => assert.ok(order.indexOf(a) < order.indexOf(b), `${a} before ${b}: ${order.join(", ")}`);
  before("User", "Project");
  before("Project", "ProjectMember");
  before("ProjectMember", "Task");
  before("TreePage", "TreeNode");
  assert.equal(order.length, 6);
});

test("refuses foreign key cycles", () => {
  assert.throws(
    () => orderTablesForRestore(["A", "B"], [{ child: "A", parent: "B" }, { child: "B", parent: "A" }]),
    /cycle/,
  );
});

test("quotes only plain table names", () => {
  assert.equal(quoteTable("ProjectMember"), '"ProjectMember"');
  assert.throws(() => quoteTable('User"; DROP TABLE "User'), /Unexpected table name/);
});

test("validates the backup file", () => {
  const valid = { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: "2026-10-20T07:00:00Z", migrations: ["m1"], tables: { User: [{ id: "u1" }] } };
  assert.equal(parseBackup(valid).tables.User.length, 1);
  assert.throws(() => parseBackup({ ...valid, format: "other" }), /not an AI Multi database backup/);
  assert.throws(() => parseBackup({ ...valid, version: 2 }), /Unsupported backup version/);
  assert.throws(() => parseBackup({ ...valid, tables: { "bad name": [] } }), /malformed/);
  assert.throws(() => parseBackup(null), /not an AI Multi database backup/);
});
