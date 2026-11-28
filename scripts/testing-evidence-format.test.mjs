import assert from "node:assert/strict";
import { test } from "node:test";
import { evidenceTable } from "./testing-evidence-format.mjs";

// GitHub reads "@name" outside code formatting as an @-mention of that account. Every PR that pasted
// the table mentioned the radix-ui account through the Radix check's result (#565, #571, #573, #574).
const MENTION = /(^|[^\w`])@[A-Za-z0-9]/;

/** A line with its code spans taken out: the text GitHub finds mentions in. */
const outsideCode = (line) => line.replace(/`[^`]*`/g, "");

test("the table, as a PR shows it: where the checks ran, then a row a check", () => {
  const table = evidenceTable("`cf123d0`", [{ name: "Unit tests", command: "`npm run test:unit`", result: "Pass: 989 of 989 tests passed" }]);
  assert.equal(
    table,
    ["Checks run on `cf123d0`:", "", "| Check | Command | Result |", "|---|---|---|", "| Unit tests | `npm run test:unit` | Pass: 989 of 989 tests passed |"].join("\n"),
  );
});

test("the table @-mentions nobody: a handle such as the Radix check's @radix-ui goes into code formatting", () => {
  const table = evidenceTable("`cf123d0`", [
    { name: "Single Radix UI copy", command: "`node scripts/check-single-radix.mjs`", result: "Pass: one version of each @radix-ui package" },
    { name: "Dependencies", command: "`npm ls`", result: "**Fail**: @prisma/client is installed twice; ask @octocat." },
  ]);
  for (const line of table.split("\n")) assert.doesNotMatch(outsideCode(line), MENTION, line);
  assert.match(table, /\| Pass: one version of each `@radix-ui` package \|/);
  assert.match(table, /\| \*\*Fail\*\*: `@prisma\/client` is installed twice; ask `@octocat`\. \|/);
});

test("email addresses, a lone @ and text already in code formatting stay as they are", () => {
  const result = "mail owner@example.com, 3 @ 4, and `@radix-ui` kept";
  const table = evidenceTable("this checkout", [{ name: "Note", command: "`echo`", result }]);
  assert.ok(table.endsWith(`| Note | \`echo\` | ${result} |`), table);
});
