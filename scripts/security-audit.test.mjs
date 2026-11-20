import assert from "node:assert/strict";
import { test } from "node:test";
import { advisoriesFrom, advisoryKeys, auditTitle, cleanReport, issueBody, keysInBody, nextStep } from "./security-audit.mjs";

// `npm audit --omit=dev --json` on main on November 19, 2026 (#508), trimmed to the fields the script reads.
const PRISMA_AUDIT = {
  auditReportVersion: 2,
  vulnerabilities: {
    "@prisma/config": { name: "@prisma/config", severity: "high", isDirect: false, via: ["effect"], effects: ["prisma"], range: ">=6.13.0-dev.1", nodes: ["node_modules/@prisma/config"] },
    effect: {
      name: "effect",
      severity: "high",
      isDirect: false,
      via: [
        {
          source: 1248071,
          name: "effect",
          dependency: "effect",
          title: "Effect: ReDoS in Schema.TemplateLiteral compiled regex",
          url: "https://github.com/advisories/GHSA-7589-6fvf-x4pw",
          severity: "high",
          range: "<=3.22.0",
        },
      ],
      effects: ["@prisma/config"],
      range: "<=3.22.0",
      nodes: ["node_modules/effect"],
    },
    prisma: { name: "prisma", severity: "high", isDirect: true, via: ["@prisma/config"], effects: [], range: ">=6.13.0-dev.1", nodes: ["node_modules/prisma"] },
  },
  metadata: { vulnerabilities: { high: 3, critical: 0, total: 3 }, dependencies: { prod: 310 } },
};
const LOCKFILE = { packages: { "node_modules/effect": { version: "3.20.0" }, "node_modules/prisma": { version: "7.10.1" } } };
const OPTIONS = { repo: "owner/repo", runUrl: "https://github.com/owner/repo/actions/runs/1", today: "2026-11-20" };

const advisory = (name, severity, id, extra = {}) => ({ source: 1, name, title: `${name} problem`, url: `https://github.com/advisories/${id}`, severity, range: "<1.0.0", ...extra });

test("an advisory in a package another one pins is reported once, with the version installed and the way in", () => {
  assert.deepEqual(advisoriesFrom(PRISMA_AUDIT, LOCKFILE), [
    {
      key: "GHSA-7589-6fvf-x4pw:effect",
      id: "GHSA-7589-6fvf-x4pw",
      name: "effect",
      severity: "high",
      title: "Effect: ReDoS in Schema.TemplateLiteral compiled regex",
      url: "https://github.com/advisories/GHSA-7589-6fvf-x4pw",
      range: "<=3.22.0",
      versions: ["3.20.0"],
      paths: [["prisma", "@prisma/config", "effect"]],
    },
  ]);
  assert.deepEqual(advisoriesFrom({ vulnerabilities: {} }), []);
  assert.deepEqual(advisoriesFrom(undefined), []);
});

test("only high and critical advisories count, most severe first, and every way a package is installed is listed", () => {
  const audit = {
    vulnerabilities: {
      // Both a direct dependency and installed through another: two ways in.
      zod: { name: "zod", isDirect: true, via: [advisory("zod", "high", "GHSA-aaaa-bbbb-cccc"), advisory("zod", "moderate", "GHSA-dddd-eeee-ffff")], effects: ["ai"], nodes: ["node_modules/zod"] },
      ai: { name: "ai", isDirect: true, via: ["zod"], effects: [], nodes: ["node_modules/ai"] },
      // Two packages that depend on each other mustn't send the walk round in circles.
      left: { name: "left", isDirect: false, via: [advisory("left", "critical", "GHSA-gggg-hhhh-jjjj")], effects: ["right"], nodes: ["node_modules/left"] },
      right: { name: "right", isDirect: false, via: ["left"], effects: ["left"], nodes: ["node_modules/right"] },
      quiet: { name: "quiet", isDirect: true, via: [advisory("quiet", "low", "GHSA-kkkk-mmmm-nnnn")], effects: [], nodes: [] },
    },
  };
  const found = advisoriesFrom(audit, { packages: { "node_modules/zod": { version: "4.1.11" } } });
  assert.deepEqual(
    found.map(({ id, name, severity, versions, paths }) => ({ id, name, severity, versions, paths })),
    [
      { id: "GHSA-gggg-hhhh-jjjj", name: "left", severity: "critical", versions: [], paths: [["right", "left"]] },
      { id: "GHSA-aaaa-bbbb-cccc", name: "zod", severity: "high", versions: ["4.1.11"], paths: [["zod"], ["ai", "zod"]] },
    ],
  );

  // The same advisory listed twice is one row; one without a GHSA link keeps npm's id.
  const twice = { vulnerabilities: { x: { name: "x", isDirect: true, via: [advisory("x", "high", "GHSA-aaaa-bbbb-cccc"), advisory("x", "high", "GHSA-aaaa-bbbb-cccc"), { source: 77, name: "x", severity: "high", title: "Old advisory" }], effects: [] } } };
  assert.deepEqual(
    advisoriesFrom(twice).map((item) => item.key),
    ["GHSA-aaaa-bbbb-cccc:x", "npm-77:x"],
  );
});

test("the title says what's affected, in plain words", () => {
  const [effect] = advisoriesFrom(PRISMA_AUDIT, LOCKFILE);
  assert.equal(auditTitle([effect]), "Security audit: effect has a high-severity advisory");
  const more = (names) => names.map((name, index) => ({ ...effect, name, key: `${index}:${name}` }));
  assert.equal(auditTitle(more(["effect", "effect"])), "Security audit: 2 high or critical advisories in effect");
  assert.equal(auditTitle(more(["effect", "next", "zod"])), "Security audit: 3 high or critical advisories in effect, next and zod");
  assert.equal(auditTitle(more(["a", "b", "c", "d"])), "Security audit: 4 high or critical advisories in 4 production dependencies");
});

test("the issue lists each advisory, says how to fix it and when it's done, and remembers which ones it listed", () => {
  const [effect] = advisoriesFrom(PRISMA_AUDIT, LOCKFILE);
  const body = issueBody([{ ...effect, title: "A | B" }], OPTIONS);
  // A backslash is escaped too, so it can't undo the pipe's escape: "C:\" then "|" stays one cell.
  assert.ok(issueBody([{ ...effect, title: "C:\\ | D" }], OPTIONS).includes("[C:\\\\ \\| D]("));
  for (const heading of ["### Summary", "### Advisories", "### How to fix", "### Acceptance criteria", "### Details"]) assert.ok(body.includes(heading), heading);
  assert.ok(
    body.includes(
      "| `effect` | 3.20.0 | high | [A \\| B](https://github.com/advisories/GHSA-7589-6fvf-x4pw) (GHSA-7589-6fvf-x4pw) | <=3.22.0 | `prisma` › `@prisma/config` › `effect` |",
    ),
    body,
  );
  assert.ok(body.includes("- [ ] `npm audit --omit=dev --audit-level=high` passes on `main`."));
  assert.ok(body.includes("[`security-audit.yml`](https://github.com/owner/repo/blob/main/.github/workflows/security-audit.yml) ([this run](https://github.com/owner/repo/actions/runs/1))"));
  assert.equal(keysInBody(body), "GHSA-7589-6fvf-x4pw:effect");
  assert.equal(keysInBody(body.replace(/\n/g, "\r\n")), "GHSA-7589-6fvf-x4pw:effect");
  assert.equal(keysInBody("No marker here."), "");
  assert.equal(keysInBody(undefined), "");
});

test("the issue opens for a new advisory, is updated while one lasts, says when the list changes, and closes once main is clean", () => {
  const advisories = advisoriesFrom(PRISMA_AUDIT, LOCKFILE);
  assert.deepEqual(nextStep([], null, OPTIONS), { kind: "none" });

  const opened = nextStep(advisories, null, OPTIONS);
  assert.equal(opened.kind, "open");
  assert.equal(opened.title, "Security audit: effect has a high-severity advisory");

  // The same advisories as last time: the list is refreshed without a comment, so nobody is notified again.
  const same = nextStep(advisories, { number: 12, body: opened.body }, OPTIONS);
  assert.deepEqual({ kind: same.kind, number: same.number, comment: same.comment }, { kind: "update", number: 12, comment: null });

  // A new one appears: the comment notifies the owner.
  const added = [...advisories, { ...advisories[0], key: "GHSA-aaaa-bbbb-cccc:zod", id: "GHSA-aaaa-bbbb-cccc", name: "zod" }];
  const changed = nextStep(added, { number: 12, body: opened.body }, OPTIONS);
  assert.equal(changed.kind, "update");
  assert.equal(changed.title, "Security audit: 2 high or critical advisories in effect and zod");
  assert.equal(
    changed.comment,
    "The list of advisories changed (2026-11-20, [run](https://github.com/owner/repo/actions/runs/1)): 2 high or critical advisories in effect and zod. The issue above has the current list.",
  );
  assert.equal(keysInBody(changed.body), advisoryKeys(added));

  assert.deepEqual(nextStep([], { number: 12, body: changed.body }, { ...OPTIONS, runUrl: null }), {
    kind: "close",
    number: 12,
    comment: "`npm audit` finds no high or critical advisories in the production dependencies on `main` any more (2026-11-20). Closing.",
  });
});

test("a clean audit says how many production packages it checked", () => {
  assert.equal(cleanReport({ metadata: { dependencies: { prod: 310 } } }), "`npm audit`: no high or critical advisories in the production dependencies (310 packages).");
  assert.equal(cleanReport({}), "`npm audit`: no high or critical advisories in the production dependencies.");
});
