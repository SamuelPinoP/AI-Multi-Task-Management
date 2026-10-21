import assert from "node:assert/strict";
import test from "node:test";
import { parseSidebarProjects, serializeSidebarProjects } from "./sidebar-state";

test("project open state round-trips through the cookie value", () => {
  const value = serializeSidebarProjects({ abc: true, def: false }, ["abc", "def"]);
  assert.equal(value, "abc:1.def:0");
  assert.deepEqual(parseSidebarProjects(value), { abc: true, def: false });
});

test("the cookie keeps only projects the sidebar still lists", () => {
  assert.equal(serializeSidebarProjects({ abc: true, gone: false }, ["abc", "new"]), "abc:1");
});

test("a missing or malformed cookie opens nothing", () => {
  assert.deepEqual(parseSidebarProjects(undefined), {});
  assert.deepEqual(parseSidebarProjects(""), {});
  assert.deepEqual(parseSidebarProjects("abc:2.:1.de f:1.ok:1"), { ok: true });
});
