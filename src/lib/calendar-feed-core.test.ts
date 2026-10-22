import assert from "node:assert/strict";
import test from "node:test";
import { buildCalendarFeed, escapeText, foldLine, repeatRule, tokenFromFeedFile, type FeedEvent } from "./calendar-feed-core";

const updatedAt = new Date("2026-10-20T15:30:00.000Z");

function event(overrides: Partial<FeedEvent>): FeedEvent {
  return {
    id: "evt1",
    title: "Stand-up",
    description: null,
    location: null,
    startTime: new Date("2026-10-20T09:00:00.000Z"),
    endTime: null,
    hasStartTime: true,
    hasEndTime: false,
    recurrence: "NONE",
    repeatUntil: null,
    updatedAt,
    projectName: null,
    ...overrides,
  };
}

/** The lines of the first VEVENT, unfolded. */
function veventLines(feed: string) {
  const lines = feed.replace(/\r\n /g, "").split("\r\n");
  return lines.slice(lines.indexOf("BEGIN:VEVENT"), lines.indexOf("END:VEVENT") + 1);
}

test("text values escape backslashes, commas, semicolons and line breaks", () => {
  assert.equal(escapeText("a\\b, c; d\ne"), "a\\\\b\\, c\\; d\\ne");
});

test("long lines fold at 75 octets without splitting a character", () => {
  const line = `SUMMARY:${"é".repeat(60)}`;
  const folded = foldLine(line);
  const parts = folded.split("\r\n");
  assert.ok(parts.length > 1);
  for (const part of parts) assert.ok(new TextEncoder().encode(part).length <= 75, part);
  assert.equal(folded.replace(/\r\n /g, ""), line);
});

test("timed events are floating wall-clock times, as stored", () => {
  const lines = veventLines(
    buildCalendarFeed({
      events: [event({ endTime: new Date("2026-10-20T09:15:00.000Z"), hasEndTime: true, location: "Room 2, floor 3", projectName: "Launch" })],
      tasks: [],
      appUrl: "https://app.example",
    }),
  );
  assert.ok(lines.includes("DTSTART:20261020T090000"));
  assert.ok(lines.includes("DTEND:20261020T091500"));
  assert.ok(lines.includes("DTSTAMP:20261020T153000Z"));
  assert.ok(lines.includes("LOCATION:Room 2\\, floor 3"));
  assert.ok(lines.includes("DESCRIPTION:Project: Launch"));
  assert.ok(lines.includes("UID:event-evt1@ai-multi"));
});

test("all-day events end the day after their last day", () => {
  const oneDay = veventLines(buildCalendarFeed({ events: [event({ startTime: new Date("2026-10-20T00:00:00.000Z"), hasStartTime: false })], tasks: [], appUrl: "" }));
  assert.ok(oneDay.includes("DTSTART;VALUE=DATE:20261020"));
  assert.ok(oneDay.includes("DTEND;VALUE=DATE:20261021"));

  const threeDays = veventLines(
    buildCalendarFeed({
      events: [event({ startTime: new Date("2026-10-30T00:00:00.000Z"), endTime: new Date("2026-11-01T00:00:00.000Z"), hasStartTime: false })],
      tasks: [],
      appUrl: "",
    }),
  );
  assert.ok(threeDays.includes("DTEND;VALUE=DATE:20261102"));
});

test("a start time with only an end date runs to the end of that day", () => {
  const lines = veventLines(buildCalendarFeed({ events: [event({ endTime: new Date("2026-10-21T00:00:00.000Z") })], tasks: [], appUrl: "" }));
  assert.ok(lines.includes("DTEND:20261022T000000"));
});

test("repeats become RRULEs, with the series end as UNTIL", () => {
  assert.equal(repeatRule(event({})), null);
  assert.equal(repeatRule(event({ recurrence: "DAILY" })), "FREQ=DAILY");
  assert.equal(repeatRule(event({ recurrence: "BIWEEKLY" })), "FREQ=WEEKLY;INTERVAL=2");
  assert.equal(
    repeatRule(event({ recurrence: "WEEKLY", repeatUntil: new Date("2026-12-15T00:00:00.000Z") })),
    "FREQ=WEEKLY;UNTIL=20261215T235959",
  );
  assert.equal(
    repeatRule(event({ recurrence: "WEEKLY", hasStartTime: false, repeatUntil: new Date("2026-12-15T00:00:00.000Z") })),
    "FREQ=WEEKLY;UNTIL=20261215",
  );
});

test("monthly repeats late in the month fall on the last day of shorter months, as in the app", () => {
  assert.equal(repeatRule(event({ recurrence: "MONTHLY" })), "FREQ=MONTHLY");
  assert.equal(
    repeatRule(event({ recurrence: "MONTHLY", startTime: new Date("2026-01-31T09:00:00.000Z") })),
    "FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1",
  );
  assert.equal(
    repeatRule(event({ recurrence: "MONTHLY", startTime: new Date("2026-01-29T09:00:00.000Z") })),
    "FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1",
  );
});

test("due tasks are free all-day entries; the feed uses CRLF and names itself", () => {
  const feed = buildCalendarFeed({
    events: [],
    tasks: [{ id: "t1", title: "Send report", description: null, dueDate: new Date("2026-10-23T00:00:00.000Z"), updatedAt, projectName: null }],
    appUrl: "https://app.example",
  });
  assert.ok(feed.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(feed.endsWith("END:VCALENDAR\r\n"));
  assert.ok(feed.includes("X-WR-CALNAME:AI Multi"));
  const lines = veventLines(feed);
  assert.ok(lines.includes("SUMMARY:Due: Send report"));
  assert.ok(lines.includes("DTSTART;VALUE=DATE:20261023"));
  assert.ok(lines.includes("DTEND;VALUE=DATE:20261024"));
  assert.ok(lines.includes("TRANSP:TRANSPARENT"));
  assert.ok(lines.includes("URL:https://app.example/tasks"));
});

test("feed links carry a 32-character token and end in .ics", () => {
  const token = "abcdefghijklmnopqrstuvwxyz012345";
  assert.equal(tokenFromFeedFile(`${token}.ics`), token);
  assert.equal(tokenFromFeedFile(token), null);
  assert.equal(tokenFromFeedFile(`${token.slice(1)}.ics`), null);
  assert.equal(tokenFromFeedFile("../etc/passwd.ics"), null);
});
