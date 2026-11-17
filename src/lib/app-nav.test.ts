import assert from "node:assert/strict";
import test from "node:test";
import { isFullHeightPage, isNavItemActive, pageTitleFor } from "./app-nav";

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
  const boards = { href: "/board", match: ["/tasks/board", "/tree"] };
  assert.equal(isNavItemActive("/tasks/board", boards), true);
  assert.equal(isNavItemActive("/tree/page-1", boards), true);
  assert.equal(isNavItemActive("/tasks", boards), false);
});

test("only the chat views and the AI page are full-height pages", () => {
  assert.equal(isFullHeightPage("/chats"), true);
  assert.equal(isFullHeightPage("/projects/p1/chat"), true);
  assert.equal(isFullHeightPage("/ai"), true);
  assert.equal(isFullHeightPage("/projects/p1"), false);
  assert.equal(isFullHeightPage("/projects/p1/board"), false);
  assert.equal(isFullHeightPage("/projects/p1/chat/extra"), false);
  assert.equal(isFullHeightPage("/chatsx"), false);
  assert.equal(isFullHeightPage("/aim"), false);
  assert.equal(isFullHeightPage("/tasks"), false);
});

test("the AI page is called AI (#308)", () => {
  assert.deepEqual(pageTitleFor("/ai", []), { title: "AI" });
  assert.deepEqual(pageTitleFor("/aim", []), { title: "" });
});

test("page titles prefer the longest matching prefix", () => {
  assert.deepEqual(pageTitleFor("/", []), { title: "Home" });
  assert.deepEqual(pageTitleFor("/tasks", []), { title: "Tasks" });
  assert.deepEqual(pageTitleFor("/tasks/board", []), { title: "Boards" });
  assert.deepEqual(pageTitleFor("/tree", []), { title: "Tree view" });
  assert.deepEqual(pageTitleFor("/tree/page-1", []), { title: "Tree view" });
  assert.deepEqual(pageTitleFor("/events", []), { title: "Calendar" });
  assert.deepEqual(pageTitleFor("/events/calendar", []), { title: "Calendar" });
  assert.deepEqual(pageTitleFor("/today", []), { title: "My day" });
  assert.deepEqual(pageTitleFor("/chats", []), { title: "Chats" });
});

test("owner-only pages get their names only for app admins (#286)", () => {
  assert.deepEqual(pageTitleFor("/usage", [], { appAdmin: true }), { title: "Free-tier usage" });
  // Everyone else sees the bar of a page that doesn't exist.
  assert.deepEqual(pageTitleFor("/usage", []), { title: "" });
  assert.deepEqual(pageTitleFor("/usage", [], { appAdmin: false }), { title: "" });
  assert.deepEqual(pageTitleFor("/nowhere", []), { title: "" });
  // Admins keep every other title.
  assert.deepEqual(pageTitleFor("/tasks", [], { appAdmin: true }), { title: "Tasks" });
  assert.deepEqual(pageTitleFor("/usagex", [], { appAdmin: true }), { title: "" });
});

test("the Users page and each person's page are named only for app admins", () => {
  assert.deepEqual(pageTitleFor("/users", [], { appAdmin: true }), { title: "Users" });
  assert.deepEqual(pageTitleFor("/users/cm123", [], { appAdmin: true }), { title: "Users" });
  assert.deepEqual(pageTitleFor("/users", []), { title: "" });
  assert.deepEqual(pageTitleFor("/users/cm123", [], { appAdmin: false }), { title: "" });
  assert.deepEqual(pageTitleFor("/usersx", [], { appAdmin: true }), { title: "" });
});

test("project pages show the project's name under Projects", () => {
  const projects = [{ id: "p1", name: "Capstone demo" }];
  assert.deepEqual(pageTitleFor("/projects/p1", projects), { parent: "Projects", title: "Capstone demo" });
  assert.deepEqual(pageTitleFor("/projects/p1/chat", projects), { parent: "Projects", title: "Capstone demo" });
  assert.deepEqual(pageTitleFor("/projects/unknown", projects), { parent: "Projects", title: "Project" });
  assert.deepEqual(pageTitleFor("/projects", projects), { title: "Projects" });
});
