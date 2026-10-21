import assert from "node:assert/strict";
import test from "node:test";
import {
  eventTimeInputValue,
  eventWallTime,
  formatEventDateTime,
  formatEventTime,
  parseEventTimes,
  parseRepeatUntil,
  toEventStorageTime,
} from "./event-time";
import { expandRecurringEventsForRange } from "./recurrence";
import { formatTaskDayKey } from "./task-date-buckets";

// Vercel runs the server in UTC and browsers can be anywhere. Every check
// below has to give the same answer whichever time zone the code runs in.
const TIME_ZONES = ["UTC", "America/New_York", "Asia/Tokyo", "Asia/Kolkata"];

function inEachTimeZone(name: string, check: () => void) {
  for (const timeZone of TIME_ZONES) {
    test(`${name} (TZ=${timeZone})`, () => {
      const previous = process.env.TZ;
      process.env.TZ = timeZone;
      try {
        check();
      } finally {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
      }
    });
  }
}

/** Newer ICU versions put a narrow no-break space before AM/PM. */
function plain(text: string) {
  return text.replace(/ /g, " ");
}

function parsed(input: Parameters<typeof parseEventTimes>[0]) {
  const result = parseEventTimes(input);
  assert.equal(result.error, undefined);
  return result.value!;
}

inEachTimeZone("stores the time the user typed", () => {
  const times = parsed({ startDate: "2026-10-20", startTime: "09:00", endDate: "2026-10-20", endTime: "09:30" });

  assert.equal(times.startTime.toISOString(), "2026-10-20T09:00:00.000Z");
  assert.equal(times.endTime?.toISOString(), "2026-10-20T09:30:00.000Z");
  assert.equal(times.hasStartTime, true);
  assert.equal(times.hasEndTime, true);
});

inEachTimeZone("shows the time the user typed", () => {
  const stored = "2026-10-20T09:00:00.000Z";

  assert.equal(plain(formatEventTime(stored)), "9:00 AM");
  assert.equal(plain(formatEventDateTime(stored)), "Oct 20, 2026, 9:00 AM");
  assert.equal(eventTimeInputValue(stored), "09:00");
});

inEachTimeZone("editing and saving does not move an event", () => {
  let stored = parsed({ startDate: "2026-10-20", startTime: "21:45", endDate: "", endTime: "" }).startTime;

  for (let save = 0; save < 3; save += 1) {
    const iso = stored.toISOString();
    stored = parsed({
      startDate: formatTaskDayKey(iso),
      startTime: eventTimeInputValue(iso),
      endDate: "",
      endTime: "",
    }).startTime;
  }

  assert.equal(stored.toISOString(), "2026-10-20T21:45:00.000Z");
});

inEachTimeZone("keeps all-day events on their date", () => {
  const times = parsed({ startDate: "2026-10-20", startTime: "", endDate: null, endTime: null });

  assert.equal(times.startTime.toISOString(), "2026-10-20T00:00:00.000Z");
  assert.equal(times.endTime, null);
  assert.equal(times.hasStartTime, false);
  assert.equal(formatTaskDayKey(times.startTime.toISOString()), "2026-10-20");
});

inEachTimeZone("compares a late-evening event with local days correctly", () => {
  const wall = eventWallTime("2026-10-20T23:30:00.000Z");

  assert.deepEqual(
    [wall.getFullYear(), wall.getMonth(), wall.getDate(), wall.getHours(), wall.getMinutes()],
    [2026, 9, 20, 23, 30],
  );
  assert.ok(wall >= new Date(2026, 9, 20));
  assert.ok(wall < new Date(2026, 9, 21));
  assert.equal(toEventStorageTime(wall).toISOString(), "2026-10-20T23:30:00.000Z");
});

inEachTimeZone("expands recurring events at the edges of a local range", () => {
  const events = [
    { id: "late-night-weekly", startTime: "2026-10-12T01:00:00.000Z", endTime: null, recurrence: "WEEKLY" as const },
    { id: "sunday-evening", startTime: "2026-10-25T22:00:00.000Z", endTime: null, recurrence: "NONE" as const },
  ];

  const occurrences = expandRecurringEventsForRange(
    events,
    new Date(2026, 9, 19, 0, 0, 0, 0),
    new Date(2026, 9, 25, 23, 59, 59, 999),
  );

  assert.deepEqual(
    occurrences.map((event) => event.startTime),
    ["2026-10-19T01:00:00.000Z", "2026-10-25T22:00:00.000Z"],
  );
});

test("rejects invalid dates and times with the existing messages", () => {
  const error = (input: Parameters<typeof parseEventTimes>[0]) => parseEventTimes(input).error;

  assert.equal(error({ startDate: "", startTime: "", endDate: "", endTime: "" }), "Start date is required");
  assert.equal(error({ startDate: "2026-02-30", startTime: "", endDate: "", endTime: "" }), "Invalid start date");
  assert.equal(error({ startDate: "2026-10-20", startTime: "24:00", endDate: "", endTime: "" }), "Invalid start time");
  assert.equal(error({ startDate: "2026-10-20", startTime: "", endDate: "10/21/2026", endTime: "" }), "Invalid end date");
  assert.equal(error({ startDate: "2026-10-20", startTime: "", endDate: "2026-10-19", endTime: "" }), "End date cannot be before start date");
  assert.equal(
    error({ startDate: "2026-10-20", startTime: "10:00", endDate: "2026-10-20", endTime: "09:00" }),
    "End time must be after start time when dates are the same",
  );
  assert.equal(
    error({ startDate: "2026-10-20", startTime: "10:00", endDate: "", endTime: "09:00" }),
    "End time must be after start time when dates are the same",
  );
});

inEachTimeZone("an end time without an end date ends on the start date", () => {
  const times = parsed({ startDate: "2026-10-20", startTime: "09:00", endDate: "", endTime: "09:15" });

  assert.equal(times.endTime?.toISOString(), "2026-10-20T09:15:00.000Z");
  assert.equal(times.hasEndTime, true);
});

inEachTimeZone("stores the repeat-until date as that day", () => {
  assert.equal(
    parseRepeatUntil({ startDate: "2026-10-20", repeatUntil: "2026-12-31" }, true).value?.toISOString(),
    "2026-12-31T00:00:00.000Z",
  );
});

test("repeat-until is empty unless the event repeats, and never before the start", () => {
  assert.deepEqual(parseRepeatUntil({ startDate: "2026-10-20", repeatUntil: "" }, true), { value: null });
  assert.deepEqual(parseRepeatUntil({ startDate: "2026-10-20", repeatUntil: null }, true), { value: null });
  assert.deepEqual(parseRepeatUntil({ startDate: "2026-10-20", repeatUntil: "2026-12-31" }, false), { value: null });
  assert.equal(parseRepeatUntil({ startDate: "2026-10-20", repeatUntil: "12/31/2026" }, true).error, "Invalid repeat-until date");
  assert.equal(
    parseRepeatUntil({ startDate: "2026-10-20", repeatUntil: "2026-10-19" }, true).error,
    "Repeat until cannot be before the start date",
  );
  assert.equal(parseRepeatUntil({ startDate: "2026-10-20", repeatUntil: "2026-10-20" }, true).error, undefined);
});
