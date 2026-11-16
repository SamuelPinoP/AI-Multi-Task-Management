import assert from "node:assert/strict";
import test from "node:test";
import { isIdSegment, scrubAnalyticsUrl } from "./web-analytics-core";

const site = "https://ai-multi.example";

test("drops query strings and fragments, where links keep their secrets", () => {
  assert.equal(scrubAnalyticsUrl(`${site}/reset-password?token=3f9a1c0e8b7d6a5f4e3d2c1b0a9f8e7d`), `${site}/reset-password`);
  assert.equal(scrubAnalyticsUrl(`${site}/verify-email?token=abc123&next=%2Fnotes`), `${site}/verify-email`);
  assert.equal(scrubAnalyticsUrl(`${site}/signup?next=%2Finvitations#top`), `${site}/signup`);
  assert.equal(scrubAnalyticsUrl(`${site}/tasks?view=board&q=salary`), `${site}/tasks`);
});

test("replaces ids in the path, so each kind of page counts once", () => {
  assert.equal(scrubAnalyticsUrl(`${site}/projects/cmwif37m800202wvef1jhlphu/chat`), `${site}/projects/:id/chat`);
  assert.equal(scrubAnalyticsUrl(`${site}/tasks/cmwif37m800202wvef1jhlphu`), `${site}/tasks/:id`);
  assert.equal(scrubAnalyticsUrl(`${site}/tree/c1234567890abcdefghijklm`), `${site}/tree/:id`);
});

test("keeps the names of pages", () => {
  for (const path of ["/", "/events/calendar", "/forgot-password", "/reset-password", "/projects", "/chats", "/privacy"]) {
    assert.equal(scrubAnalyticsUrl(`${site}${path}`), `${site}${path}`);
  }
});

test("tells ids from long page names", () => {
  assert.equal(isIdSegment("cmwif37m800202wvef1jhlphu"), true);
  assert.equal(isIdSegment("3f9a1c0e8b7d6a5f4e3d2c1b0a9f8e7d"), true);
  assert.equal(isIdSegment("forgot-password"), false);
  assert.equal(isIdSegment("a-very-long-page-name"), false);
  assert.equal(isIdSegment("2026"), false);
  assert.equal(isIdSegment(""), false);
});

test("handles relative and unreadable addresses", () => {
  assert.equal(scrubAnalyticsUrl("/notes?filter=pinned"), "/notes");
  assert.equal(scrubAnalyticsUrl("/projects/cmwif37m800202wvef1jhlphu"), "/projects/:id");
  assert.equal(scrubAnalyticsUrl("http://[bad"), "/");
});
