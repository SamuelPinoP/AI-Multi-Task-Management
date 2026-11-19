// An in-memory stand-in for the database the agent's read tools query (#311),
// so the evaluations run the real tools on a sample workspace with no
// Postgres: in CI with the unit tests, and on any machine for a live run.
//
// It understands exactly the Prisma query features those tools use (findMany
// with where, orderBy, take and select; groupBy with _count) and throws on
// anything else. A tool that starts using a new filter then fails loudly here
// instead of quietly reading the wrong rows. Filters follow Postgres: a
// comparison with NULL is never true, and NULLs sort last going up, first
// going down.
import type { ToolDb } from "@/lib/ai/tools/define";

export type ModelName = "task" | "event" | "project" | "projectMember" | "note" | "weeklyGoal";

export type Row = Record<string, unknown>;

export type Tables = Record<ModelName, Row[]>;

/**
 * How the models link, as in prisma/schema.prisma: a "one" relation follows a foreign key on the
 * row; a "many" relation finds the rows whose foreign key is this row's id.
 */
type Relation = { model: ModelName; kind: "one"; foreignKey: string } | { model: ModelName; kind: "many"; foreignKey: string };

const RELATIONS: Record<ModelName, Record<string, Relation>> = {
  task: {
    project: { model: "project", kind: "one", foreignKey: "projectId" },
    assignee: { model: "projectMember", kind: "one", foreignKey: "assigneeId" },
    goal: { model: "weeklyGoal", kind: "one", foreignKey: "goalId" },
  },
  event: { project: { model: "project", kind: "one", foreignKey: "projectId" } },
  project: {
    members: { model: "projectMember", kind: "many", foreignKey: "projectId" },
    tasks: { model: "task", kind: "many", foreignKey: "projectId" },
    notes: { model: "note", kind: "many", foreignKey: "projectId" },
    events: { model: "event", kind: "many", foreignKey: "projectId" },
  },
  projectMember: { project: { model: "project", kind: "one", foreignKey: "projectId" } },
  note: { project: { model: "project", kind: "one", foreignKey: "projectId" } },
  weeklyGoal: { tasks: { model: "task", kind: "many", foreignKey: "goalId" } },
};

/** Postgres sorts enum values in the order the schema declares them, not alphabetically. */
const ENUM_ORDER: Record<string, string[]> = {
  priority: ["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"],
  status: ["TODO", "IN_PROGRESS", "DONE", "ACTIVE", "COMPLETED", "ARCHIVED"],
};

function unsupported(what: string): never {
  throw new Error(`The evaluations' in-memory database doesn't support ${what}. Add it to src/lib/ai/evals/memory-db.ts.`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

type Scalar = string | number | boolean | Date;

function isScalar(value: unknown): value is Scalar {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value instanceof Date;
}

function sameValue(a: unknown, b: unknown) {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

/** -1, 0 or 1; only for two non-null values of the same kind. */
function compareValues(a: unknown, b: unknown, field: string) {
  if (a instanceof Date && b instanceof Date) return Math.sign(a.getTime() - b.getTime());
  if (typeof a === "string" && typeof b === "string") {
    const order = ENUM_ORDER[field];
    if (order && order.includes(a) && order.includes(b)) return Math.sign(order.indexOf(a) - order.indexOf(b));
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === "number" && typeof b === "number") return Math.sign(a - b);
  if (typeof a === "boolean" && typeof b === "boolean") return a === b ? 0 : a ? 1 : -1;
  return unsupported(`comparing ${field} values of different kinds`);
}

const FIELD_OPERATORS = new Set(["equals", "not", "in", "notIn", "lt", "lte", "gt", "gte", "contains", "startsWith", "endsWith", "mode"]);

/** A scalar field's filter: a value (null for "is null") or an object of operators. */
function matchesField(value: unknown, condition: unknown, field: string): boolean {
  if (condition === null) return value === null || value === undefined;
  if (isScalar(condition)) return value !== null && value !== undefined && sameValue(value, condition);
  if (!isPlainObject(condition)) return unsupported(`the filter on ${field}: ${JSON.stringify(condition)}`);

  const insensitive = condition.mode === "insensitive";
  if (condition.mode !== undefined && condition.mode !== "insensitive" && condition.mode !== "default") {
    unsupported(`mode "${String(condition.mode)}" on ${field}`);
  }
  const text = (input: unknown) => (insensitive ? String(input).toLowerCase() : String(input));
  for (const [operator, operand] of Object.entries(condition)) {
    if (operand === undefined || operator === "mode") continue;
    if (!FIELD_OPERATORS.has(operator)) unsupported(`the "${operator}" filter on ${field}`);
    const present = value !== null && value !== undefined;
    switch (operator) {
      case "equals":
        if (!matchesField(value, operand, field)) return false;
        break;
      case "not":
        // SQL's `<>` is never true for NULL; `not: null` is "IS NOT NULL".
        if (operand === null) {
          if (!present) return false;
        } else if (isPlainObject(operand)) {
          if (!present || matchesField(value, operand, field)) return false;
        } else if (!present || sameValue(value, operand)) {
          return false;
        }
        break;
      case "in":
      case "notIn": {
        if (!Array.isArray(operand)) unsupported(`a non-list "${operator}" on ${field}`);
        const found = present && operand.some((item) => sameValue(value, item));
        if (operator === "in" ? !found : !present || found) return false;
        break;
      }
      case "lt":
      case "lte":
      case "gt":
      case "gte": {
        if (!present || operand === null) return false;
        const order = compareValues(value, operand, field);
        const pass = operator === "lt" ? order < 0 : operator === "lte" ? order <= 0 : operator === "gt" ? order > 0 : order >= 0;
        if (!pass) return false;
        break;
      }
      case "contains":
      case "startsWith":
      case "endsWith": {
        if (!present || typeof value !== "string" || typeof operand !== "string") return false;
        const haystack = text(value);
        const needle = text(operand);
        const pass = operator === "contains" ? haystack.includes(needle) : operator === "startsWith" ? haystack.startsWith(needle) : haystack.endsWith(needle);
        if (!pass) return false;
        break;
      }
    }
  }
  return true;
}

function relatedRows(tables: Tables, model: ModelName, row: Row, relation: Relation): Row[] {
  if (relation.kind === "one") {
    const key = row[relation.foreignKey];
    if (key === null || key === undefined) return [];
    return tables[relation.model].filter((candidate) => candidate.id === key);
  }
  return tables[relation.model].filter((candidate) => candidate[relation.foreignKey] === row.id);
}

function matchesRelation(tables: Tables, model: ModelName, row: Row, name: string, relation: Relation, condition: unknown): boolean {
  const related = relatedRows(tables, model, row, relation);
  if (relation.kind === "one") {
    const [target] = related;
    if (condition === null) return target === undefined;
    if (!isPlainObject(condition)) return unsupported(`the filter on ${model}.${name}`);
    if ("is" in condition || "isNot" in condition) {
      if (Object.keys(condition).length !== 1) unsupported(`mixing is/isNot with other filters on ${model}.${name}`);
      if ("is" in condition) return condition.is === null ? target === undefined : target !== undefined && matches(tables, relation.model, target, condition.is);
      return condition.isNot === null ? target !== undefined : target === undefined || !matches(tables, relation.model, target, condition.isNot);
    }
    // `project: { name: … }` means the task has a project, and it matches.
    return target !== undefined && matches(tables, relation.model, target, condition);
  }

  if (!isPlainObject(condition)) return unsupported(`the filter on ${model}.${name}`);
  for (const [operator, filter] of Object.entries(condition)) {
    if (filter === undefined) continue;
    const hit = (candidate: Row) => matches(tables, relation.model, candidate, filter);
    if (operator === "some" && !related.some(hit)) return false;
    else if (operator === "every" && !related.every(hit)) return false;
    else if (operator === "none" && related.some(hit)) return false;
    else if (!["some", "every", "none"].includes(operator)) unsupported(`"${operator}" on ${model}.${name}`);
  }
  return true;
}

/** Whether `row` of `model` passes a Prisma `where`. */
export function matches(tables: Tables, model: ModelName, row: Row, where: unknown): boolean {
  if (where === undefined) return true;
  if (!isPlainObject(where)) return unsupported(`a ${model} filter that isn't an object: ${JSON.stringify(where)}`);
  for (const [key, condition] of Object.entries(where)) {
    // Prisma skips undefined filters.
    if (condition === undefined) continue;
    if (key === "AND" || key === "NOT") {
      const list = Array.isArray(condition) ? condition : [condition];
      const results = list.map((item) => matches(tables, model, row, item));
      if (key === "AND" ? results.includes(false) : results.includes(true)) return false;
      continue;
    }
    if (key === "OR") {
      if (!Array.isArray(condition)) unsupported(`an OR that isn't a list on ${model}`);
      if (!condition.some((item) => matches(tables, model, row, item))) return false;
      continue;
    }
    const relation = RELATIONS[model][key];
    if (relation) {
      if (!matchesRelation(tables, model, row, key, relation, condition)) return false;
      continue;
    }
    if (!(key in row)) unsupported(`filtering ${model} on "${key}", which the sample workspace doesn't have`);
    if (!matchesField(row[key], condition, key)) return false;
  }
  return true;
}

type OrderBy = Record<string, unknown> | Array<Record<string, unknown>> | undefined;

function sortRows(model: ModelName, rows: Row[], orderBy: OrderBy) {
  if (orderBy === undefined) return rows;
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).map((entry) => {
    const pairs = Object.entries(entry);
    if (pairs.length !== 1) unsupported(`an orderBy entry with ${pairs.length} fields on ${model}`);
    const [field, direction] = pairs[0];
    if (direction !== "asc" && direction !== "desc") unsupported(`ordering ${model} by ${field} with ${JSON.stringify(direction)}`);
    if (RELATIONS[model][field]) unsupported(`ordering ${model} by its relation ${field}`);
    return { field, descending: direction === "desc" };
  });
  // A stable sort: rows that tie keep the workspace's order.
  return [...rows].sort((a, b) => {
    for (const { field, descending } of keys) {
      const left = a[field] ?? null;
      const right = b[field] ?? null;
      if (left === null && right === null) continue;
      // Postgres: NULLS LAST going up, NULLS FIRST going down.
      if (left === null) return descending ? -1 : 1;
      if (right === null) return descending ? 1 : -1;
      const order = compareValues(left, right, field);
      if (order !== 0) return descending ? -order : order;
    }
    return 0;
  });
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

const NESTED_KEYS = new Set(["select", "where", "orderBy", "take"]);

/** The fields a query selects, relations included, as Prisma returns them. */
function selectFields(tables: Tables, model: ModelName, row: Row, select: unknown): Row {
  if (select === undefined) {
    return Object.fromEntries(Object.entries(row).filter(([key]) => !RELATIONS[model][key]).map(([key, value]) => [key, copy(value)]));
  }
  if (!isPlainObject(select)) return unsupported(`a ${model} select that isn't an object`);
  const out: Row = {};
  for (const [key, spec] of Object.entries(select)) {
    if (spec === false || spec === undefined) continue;
    const relation = RELATIONS[model][key];
    if (!relation) {
      if (spec !== true) unsupported(`selecting ${model}.${key} with ${JSON.stringify(spec)}`);
      if (!(key in row)) unsupported(`selecting ${model}.${key}, which the sample workspace doesn't have`);
      out[key] = copy(row[key]);
      continue;
    }
    const nested = spec === true ? {} : spec;
    if (!isPlainObject(nested)) return unsupported(`selecting ${model}.${key} with ${JSON.stringify(spec)}`);
    for (const option of Object.keys(nested)) if (!NESTED_KEYS.has(option)) unsupported(`"${option}" inside ${model}.${key}`);
    let related = relatedRows(tables, model, row, relation);
    if (relation.kind === "one") {
      if (nested.where !== undefined || nested.orderBy !== undefined || nested.take !== undefined) unsupported(`filtering the one-to-one ${model}.${key}`);
      out[key] = related[0] ? selectFields(tables, relation.model, related[0], nested.select) : null;
      continue;
    }
    related = related.filter((candidate) => matches(tables, relation.model, candidate, nested.where));
    related = sortRows(relation.model, related, nested.orderBy as OrderBy);
    if (typeof nested.take === "number") related = related.slice(0, nested.take);
    out[key] = related.map((candidate) => selectFields(tables, relation.model, candidate, nested.select));
  }
  return out;
}

function checkOptions(model: ModelName, method: string, args: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(args)) if (!allowed.includes(key)) unsupported(`"${key}" in ${model}.${method}`);
}

function findMany(tables: Tables, model: ModelName, args: Record<string, unknown> = {}) {
  checkOptions(model, "findMany", args, ["where", "orderBy", "take", "select"]);
  let rows = tables[model].filter((row) => matches(tables, model, row, args.where));
  rows = sortRows(model, rows, args.orderBy as OrderBy);
  if (args.take !== undefined) {
    if (typeof args.take !== "number" || args.take < 0) unsupported(`take ${JSON.stringify(args.take)} on ${model}`);
    rows = rows.slice(0, args.take);
  }
  return rows.map((row) => selectFields(tables, model, row, args.select));
}

function groupBy(tables: Tables, model: ModelName, args: Record<string, unknown>) {
  checkOptions(model, "groupBy", args, ["by", "where", "_count"]);
  const by = args.by;
  if (!Array.isArray(by) || by.some((field) => typeof field !== "string")) return unsupported(`groupBy without a list of fields on ${model}`);
  if (JSON.stringify(args._count) !== JSON.stringify({ _all: true })) unsupported(`groupBy counts other than { _all: true } on ${model}`);
  const groups = new Map<string, Row>();
  for (const row of tables[model]) {
    if (!matches(tables, model, row, args.where)) continue;
    const values = by.map((field: string) => {
      if (!(field in row)) unsupported(`grouping ${model} by "${field}"`);
      return row[field] ?? null;
    });
    const key = JSON.stringify(values);
    const group = groups.get(key) ?? { ...Object.fromEntries(by.map((field: string, index: number) => [field, copy(values[index])])), _count: { _all: 0 } };
    (group._count as { _all: number })._all += 1;
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** The tools' database over `tables`. It only reads: the tools never write. */
export function createMemoryDb(tables: Tables): ToolDb {
  const model = (name: ModelName) => ({
    findMany: async (args?: Record<string, unknown>) => findMany(tables, name, args),
    groupBy: async (args: Record<string, unknown>) => groupBy(tables, name, args),
  });
  return { task: model("task"), event: model("event"), project: model("project"), note: model("note"), weeklyGoal: model("weeklyGoal") } as unknown as ToolDb;
}
