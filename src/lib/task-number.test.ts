import assert from "node:assert/strict";
import test from "node:test";
import {
  BRANCH_NAME_MAX,
  findTaskNumbers,
  formatTaskNumber,
  parseTaskNumber,
  parseTaskNumberQuery,
  taskBranchName,
  taskNumberPath,
  taskNumberSpans,
} from "./task-number";

test("a task's number reads AM-142, and its short address is /t/142", () => {
  assert.equal(formatTaskNumber(142), "AM-142");
  assert.equal(formatTaskNumber(1), "AM-1");
  assert.equal(taskNumberPath(142), "/t/142");
});

test("the branch name is the number and the title in lowercase", () => {
  assert.equal(taskBranchName(142, "Dark and light mode"), "am-142-dark-and-light-mode");
  // Punctuation and runs of spaces become one hyphen, with none at either end.
  assert.equal(taskBranchName(7, "  Fix: the sign-up form (again)!  "), "am-7-fix-the-sign-up-form-again");
  assert.equal(taskBranchName(8, "Ship v2.0 & tell @dana"), "am-8-ship-v2-0-tell-dana");
  // Accents fold to plain letters; what has no plain letter goes, leaving the number.
  assert.equal(taskBranchName(9, "Révisér le café"), "am-9-reviser-le-cafe");
  assert.equal(taskBranchName(10, "修复登录 🚀"), "am-10");
  assert.equal(taskBranchName(11, ""), "am-11");
});

test("the branch name is at most 50 characters, cut at a whole word", () => {
  const long = taskBranchName(142, "Let people pick a light or dark theme and follow the system setting by default");
  assert.equal(long, "am-142-let-people-pick-a-light-or-dark-theme-and");
  assert.ok(long.length <= BRANCH_NAME_MAX);
  // A title whose words end exactly at 50 characters keeps all 50.
  const exact = taskBranchName(142, `${"a".repeat(20)} ${"b".repeat(22)} more`);
  assert.equal(exact, `am-142-${"a".repeat(20)}-${"b".repeat(22)}`);
  assert.equal(exact.length, BRANCH_NAME_MAX);
  // One word too long to fit leaves the number alone.
  assert.equal(taskBranchName(142, "x".repeat(80)), "am-142");
  assert.equal(taskBranchName(2_147_483_647, "Dark and light mode for every page of the app"), "am-2147483647-dark-and-light-mode-for-every-page");
});

test("finds AM numbers in text, in any case, as whole words", () => {
  assert.deepEqual(findTaskNumbers("AM-142"), [142]);
  assert.deepEqual(findTaskNumbers("Fixes am-142."), [142]);
  assert.deepEqual(findTaskNumbers("am-142-dark-mode"), [142]);
  assert.deepEqual(findTaskNumbers("samuel/am-142-dark-mode"), [142]);
  assert.deepEqual(findTaskNumbers("Part of (Am-7), see AM-9 and AM-7 again"), [7, 9]);
  assert.deepEqual(findTaskNumbers("XAM-142"), []);
  assert.deepEqual(findTaskNumbers("AM-142x"), []);
  assert.deepEqual(findTaskNumbers("AM-142_old"), []);
  assert.deepEqual(findTaskNumbers("éAM-142"), []);
  assert.deepEqual(findTaskNumbers("AM-1٢"), []);
  assert.deepEqual(findTaskNumbers("AM- 142, AM142, PM-142"), []);
  // Not a number a task can have: none is 0, and none is past Postgres's integer.
  assert.deepEqual(findTaskNumbers("AM-0 AM-2147483648 AM-12345678901"), []);
  assert.deepEqual(findTaskNumbers("AM-2147483647"), [2_147_483_647]);
});

test("says where each AM number is, for hiding it from the date reader", () => {
  assert.deepEqual(taskNumberSpans("Review AM-3 Dec"), [{ start: 7, end: 11, number: 3 }]);
  assert.deepEqual(taskNumberSpans("am-1 am-2"), [
    { start: 0, end: 4, number: 1 },
    { start: 5, end: 9, number: 2 },
  ]);
});

test("a text that is just AM-142 names that task; the AI's tools take it in place of a title", () => {
  for (const text of ["AM-142", "am-142", " Am-142 "]) assert.equal(parseTaskNumber(text), 142, text);
  // A bare 142 may be part of a title ("Room 142"), so only the AM form counts.
  for (const text of ["142", "#142", "AM-142 dark mode", "Fix AM-142", "AM-0"]) assert.equal(parseTaskNumber(text), null, text);
});

test("a search for AM-142, #142 or 142 names the task by number; other searches don't", () => {
  for (const query of ["AM-142", "am-142", " AM-142 ", "#142", "142"]) assert.equal(parseTaskNumberQuery(query), 142, query);
  for (const query of ["", "AM-", "AM142", "AM-142 dark", "dark mode", "14.2", "-142", "AM-0", "0"]) assert.equal(parseTaskNumberQuery(query), null, query);
});
