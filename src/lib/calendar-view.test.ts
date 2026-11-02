import assert from "node:assert/strict";
import test from "node:test";
import { isNavItemActive } from "./app-nav";
import { calendarNavItem, calendarViewFromCookies } from "./calendar-view";

test("one Calendar item opens the view used last and is active on both views", () => {
  assert.equal(calendarNavItem("agenda").href, "/events");
  assert.equal(calendarNavItem("month").href, "/events/calendar");
  for (const view of ["agenda", "month"] as const) {
    const calendar = calendarNavItem(view);
    assert.equal(isNavItemActive("/events", calendar), true);
    assert.equal(isNavItemActive("/events/calendar", calendar), true);
    assert.equal(isNavItemActive("/eventsx", calendar), false);
    assert.equal(isNavItemActive("/tasks", calendar), false);
    assert.equal(isNavItemActive("/", calendar), false);
  }
});

test("the view comes from its cookie, and is the agenda by default", () => {
  assert.equal(calendarViewFromCookies(""), "agenda");
  assert.equal(calendarViewFromCookies("calendar-view=month"), "month");
  assert.equal(calendarViewFromCookies("sidebar-collapsed=1; calendar-view=month; tz=UTC"), "month");
  assert.equal(calendarViewFromCookies("calendar-view=agenda"), "agenda");
  assert.equal(calendarViewFromCookies("calendar-view=week"), "agenda");
  assert.equal(calendarViewFromCookies("old-calendar-view=month"), "agenda");
});
