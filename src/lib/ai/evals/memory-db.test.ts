// The evaluations' in-memory database (#311) must read like Postgres does, or
// the evaluations would test the tools against the wrong rows.
import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryDb, type Tables } from "./memory-db";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

type Rows = Array<Record<string, unknown>>;
type LooseModel = { findMany(args?: object): Promise<Rows>; groupBy(args: object): Promise<Rows> };

/** The database without Prisma's types, so a test can send what the tools never would. */
function memoryDb(source: Tables = tables()) {
  return createMemoryDb(source) as unknown as { task: LooseModel; weeklyGoal: LooseModel };
}

function tables(): Tables {
  return {
    project: [
      { id: "p1", name: "Website Redesign", userId: "owner", status: "ACTIVE", updatedAt: day("2026-11-10") },
      { id: "p2", name: "Garden", userId: "someone", status: "ACTIVE", updatedAt: day("2026-11-12") },
    ],
    projectMember: [{ id: "m1", projectId: "p2", userId: "member", name: "Member" }],
    task: [
      { id: "t1", title: "Low, due early", status: "TODO", priority: "LOW", dueDate: day("2026-11-01"), projectId: "p1", userId: "owner", assigneeId: null, goalId: null, deletedAt: null, updatedAt: day("2026-11-01") },
      { id: "t2", title: "Urgent, no date", status: "TODO", priority: "URGENT", dueDate: null, projectId: null, userId: "owner", assigneeId: null, goalId: "g1", deletedAt: null, updatedAt: day("2026-11-02") },
      { id: "t3", title: "None, due early", status: "DONE", priority: "NONE", dueDate: day("2026-11-01"), projectId: "p2", userId: "someone", assigneeId: "m1", goalId: "g1", deletedAt: null, updatedAt: day("2026-11-03") },
      { id: "t4", title: "High, deleted", status: "TODO", priority: "HIGH", dueDate: day("2026-11-05"), projectId: "p1", userId: "owner", assigneeId: null, goalId: null, deletedAt: day("2026-11-06"), updatedAt: day("2026-11-04") },
    ],
    event: [],
    note: [],
    weeklyGoal: [{ id: "g1", title: "Goal", userId: "owner", status: "ACTIVE", targetWeek: "2026-W47", createdAt: day("2026-11-16") }],
  };
}

test("orders like Postgres: enums by declaration, NULLs last going up and first going down", async () => {
  const db = memoryDb();
  const byDue = await db.task.findMany({ orderBy: [{ dueDate: "asc" }, { priority: "desc" }], select: { id: true } });
  assert.deepEqual(byDue.map((task) => task.id), ["t1", "t3", "t4", "t2"], "same day: LOW before NONE when descending; no date last");
  const byPriority = await db.task.findMany({ orderBy: { priority: "desc" }, select: { id: true } });
  assert.deepEqual(byPriority.map((task) => task.id), ["t2", "t4", "t1", "t3"], "URGENT, HIGH, LOW, NONE, not alphabetical");
  const descDue = await db.task.findMany({ orderBy: { dueDate: "desc" }, take: 1, select: { id: true } });
  assert.deepEqual(descDue.map((task) => task.id), ["t2"], "NULLs first going down");
});

test("comparisons with NULL are never true, as in SQL", async () => {
  const db = memoryDb();
  const ids = async (where: object) => (await db.task.findMany({ where, select: { id: true } })).map((task) => task.id);
  assert.deepEqual(await ids({ dueDate: { lt: day("2026-11-30") } }), ["t1", "t3", "t4"]);
  assert.deepEqual(await ids({ projectId: { not: "p1" } }), ["t3"], "a task with no project isn't 'not p1'");
  assert.deepEqual(await ids({ dueDate: null }), ["t2"]);
  assert.deepEqual(await ids({ dueDate: { not: null } }), ["t1", "t3", "t4"]);
  assert.deepEqual(await ids({ id: { in: ["t2", "t3", "nope"] } }), ["t2", "t3"]);
});

test("follows relations: a project's name, its members, and what a select nests", async () => {
  const db = memoryDb();
  const access = (userId: string) => ({ deletedAt: null, OR: [{ userId }, { project: { OR: [{ userId }, { members: { some: { userId } } }] } }] });
  const member = await db.task.findMany({ where: access("member"), select: { id: true } });
  assert.deepEqual(member.map((task) => task.id), ["t3"], "a member sees the project's tasks, and nothing else");
  const named = await db.task.findMany({ where: { project: { name: { contains: "redesign", mode: "insensitive" } } }, select: { id: true } });
  assert.deepEqual(named.map((task) => task.id), ["t1", "t4"]);
  const caseSensitive = await db.task.findMany({ where: { project: { name: { contains: "redesign" } } }, select: { id: true } });
  assert.deepEqual(caseSensitive, []);

  const [task] = await db.task.findMany({ where: { id: "t3" }, select: { title: true, project: { select: { name: true } }, assignee: { select: { userId: true } } } });
  assert.deepEqual(task, { title: "None, due early", project: { name: "Garden" }, assignee: { userId: "member" } });
  const [goal] = await db.weeklyGoal.findMany({ select: { title: true, tasks: { where: { status: "DONE" }, select: { id: true } } } });
  assert.deepEqual(goal, { title: "Goal", tasks: [{ id: "t3" }] });
});

test("counts groups like groupBy with _count", async () => {
  const db = memoryDb();
  const groups = await db.task.groupBy({ by: ["projectId", "status"], where: { deletedAt: null }, _count: { _all: true } });
  assert.deepEqual(groups, [
    { projectId: "p1", status: "TODO", _count: { _all: 1 } },
    { projectId: null, status: "TODO", _count: { _all: 1 } },
    { projectId: "p2", status: "DONE", _count: { _all: 1 } },
  ]);
});

test("returns copies, and refuses what it doesn't understand instead of guessing", async () => {
  const source = tables();
  const db = memoryDb(source);
  const [found] = await db.task.findMany({ where: { id: "t1" } });
  (found.dueDate as Date).setUTCFullYear(1999);
  assert.equal((source.task[0].dueDate as Date).getUTCFullYear(), 2026);

  await assert.rejects(db.task.findMany({ where: { title: { search: "x" } } }), /doesn't support the "search" filter/);
  await assert.rejects(db.task.findMany({ where: { color: "red" } }), /filtering task on "color"/);
  await assert.rejects(db.task.findMany({ distinct: ["title"] }), /"distinct" in task.findMany/);
  await assert.rejects(db.task.findMany({ select: { secret: true } }), /selecting task.secret/);
});
