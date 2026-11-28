import assert from "node:assert/strict";
import test from "node:test";
import { systemPrompt } from "./prompt";

test("the prompt dates today in the person's time zone, for the dates the model works out (#310)", () => {
  // 3:30 PM UTC on Thursday: Friday has begun in Tokyo, while it's Thursday morning in Los Angeles.
  const realNow = new Date("2026-11-19T15:30:00.000Z");
  assert.match(systemPrompt({ realNow, timeZone: "Asia/Tokyo" }), /It is Friday, November 20, 2026.* \(2026-11-20\) in the person's time zone, Asia\/Tokyo\./);
  assert.match(systemPrompt({ realNow, timeZone: "America/Los_Angeles" }), /It is Thursday, November 19, 2026.* \(2026-11-19\) in the person's time zone, America\/Los_Angeles\./);
  assert.match(systemPrompt({ realNow, timeZone: null }), /\(2026-11-19\) in the person's time zone, UTC\./);
  assert.match(systemPrompt({ realNow, timeZone: null }), /"tomorrow at 3" is tomorrow's date at 15:00/);
});

test("the prompt gives this week's and next week's dates, Monday to Sunday, in the person's time zone (#504)", () => {
  const weeks = (realNow: string, timeZone: string | null) => /Weeks run Monday to Sunday: this week is (.+?), and next week is (.+?)\. /.exec(systemPrompt({ realNow: new Date(realNow), timeZone }))?.slice(1);
  // Thursday, November 19, 2026 in Los Angeles, the evaluations' day: next week isn't the next 7 days.
  assert.deepEqual(weeks("2026-11-19T17:20:00.000Z", "America/Los_Angeles"), ["2026-11-16 to 2026-11-22 (2026-W47)", "2026-11-23 to 2026-11-29 (2026-W48)"]);
  // Sunday evening in UTC is already Monday in Tokyo, where a new week has begun.
  assert.deepEqual(weeks("2026-11-22T20:00:00.000Z", null), ["2026-11-16 to 2026-11-22 (2026-W47)", "2026-11-23 to 2026-11-29 (2026-W48)"]);
  assert.deepEqual(weeks("2026-11-22T20:00:00.000Z", "Asia/Tokyo"), ["2026-11-23 to 2026-11-29 (2026-W48)", "2026-11-30 to 2026-12-06 (2026-W49)"]);
  // Across the year: 2026 ends in its week 53, and next week is 2027's first.
  assert.deepEqual(weeks("2026-12-31T12:00:00.000Z", "UTC"), ["2026-12-28 to 2027-01-03 (2026-W53)", "2027-01-04 to 2027-01-10 (2027-W01)"]);
});

test("the prompt says a task number such as AM-142 names a task, never a time or a date (#486)", () => {
  const prompt = systemPrompt({ realNow: new Date("2026-11-19T15:30:00.000Z"), timeZone: "America/Los_Angeles" });
  assert.match(prompt, /AM-142 is task number 142, never a time or a date/);
  assert.match(prompt, /give it to the tools wherever they take a task/);
});
