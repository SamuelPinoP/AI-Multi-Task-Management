import assert from "node:assert/strict";
import test from "node:test";
import { isNavItemActive, pageTitleFor } from "./app-nav";

test("Home is active only on /", () => {
  assert.equal(isNavItemActive("/", { href: "/" }), true);
  assert.equal(isNavItemActive("/tasks", { href: "/" }), false);
});

test("exact items ignore nested paths", () => {
  assert.equal(isNavItemActive("/events", { href: "/events", exact: true }), true);
  assert.equal(isNavItemActive("/events/calendar", { href: "/events", exact: true }), false);
  assert.equal(isNavItemActive("/events/calendar", { href: "/events/calendar" }), true);
});

test("prefix items match nested paths but not lookalikes", () => {
  assert.equal(isNavItemActive("/projects/abc/chat", { href: "/projects" }), true);
  assert.equal(isNavItemActive("/projectsx", { href: "/projects" }), false);
});

test("extra paths count as the item", () => {
  const boards = { href: "/board", match: ["/tasks/board"] };
  assert.equal(isNavItemActive("/tasks/board", boards), true);
  assert.equal(isNavItemActive("/tasks", boards), false);
});

test("page titles prefer the longest matching prefix", () => {
  assert.deepEqual(pageTitleFor("/", []), { title: "Home" });
  assert.deepEqual(pageTitleFor("/tasks", []), { title: "Tasks" });
  assert.deepEqual(pageTitleFor("/tasks/board", []), { title: "Boards" });
  assert.deepEqual(pageTitleFor("/events/calendar", []), { title: "Calendar" });
  assert.deepEqual(pageTitleFor("/today", []), { title: "My day" });
});

test("project pages show the project's name under Projects", () => {
  const projects = [{ id: "p1", name: "Capstone demo" }];
  assert.deepEqual(pageTitleFor("/projects/p1", projects), { parent: "Projects", title: "Capstone demo" });
  assert.deepEqual(pageTitleFor("/projects/p1/chat", projects), { parent: "Projects", title: "Capstone demo" });
  assert.deepEqual(pageTitleFor("/projects/unknown", projects), { parent: "Projects", title: "Project" });
  assert.deepEqual(pageTitleFor("/projects", projects), { title: "Projects" });
});
