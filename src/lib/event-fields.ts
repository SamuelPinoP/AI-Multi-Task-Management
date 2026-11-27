// The event form's fields, checked: what POST /api/events and PATCH /api/events/[id] accept, and
// what the AI assistant's and connected AI apps' events are checked with too (#310, #479). No
// server imports, so the AI's tools and their unit tests share the same rules and messages.
// Times are wall-clock values (src/lib/event-time.ts).
import { parseEventTimes, parseRepeatUntil, type ParsedEventTimes } from "@/lib/event-time";
import { isValidRecurrence, normalizeRecurrence, type RecurrenceValue } from "@/lib/recurrence";

export type EventCreateData = {
  title: string;
  description: string | null;
  location: string | null;
  times: ParsedEventTimes;
  recurrence: RecurrenceValue;
  repeatUntil: Date | null;
  projectId: string | null;
};

/** An event's new state, as the event form saves it. */
export type EventUpdateData = Omit<EventCreateData, "repeatUntil"> & {
  /** Undefined leaves the date as it is: the request didn't send one, and the event still repeats. */
  repeatUntil: Date | null | undefined;
};

function optionalText(value: unknown) {
  return typeof value === "string" ? value.trim() || null : null;
}

/**
 * A new event from the fields the event form sends (`startDate`, `startTime`, `endDate`, `endTime`
 * as `YYYY-MM-DD` and `HH:MM`, `recurrence`, `repeatUntil`…), or the message for a 400.
 */
export function parseEventCreateBody(body: Record<string, unknown>): { data: EventCreateData } | { error: string } {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return { error: "Title is required" };

  const times = parseEventTimes({ startDate: body.startDate, startTime: body.startTime, endDate: body.endDate, endTime: body.endTime });
  if (times.error !== undefined) return { error: times.error };

  if (body.recurrence && !isValidRecurrence(body.recurrence)) return { error: "Invalid recurrence" };
  const recurrence = normalizeRecurrence(body.recurrence);
  const repeatUntil = parseRepeatUntil({ startDate: body.startDate, repeatUntil: body.repeatUntil }, recurrence !== "NONE");
  if (repeatUntil.error !== undefined) return { error: repeatUntil.error };

  return {
    data: {
      title,
      description: optionalText(body.description),
      location: optionalText(body.location),
      times: times.value,
      recurrence,
      repeatUntil: repeatUntil.value,
      projectId: optionalText(body.projectId),
    },
  };
}

/**
 * An event's new state from the fields the event form sends, as for a new one, or the message for a
 * 400. The form always sends `recurrence`, so a change without a valid one is refused.
 */
export function parseEventUpdateBody(body: Record<string, unknown>): { data: EventUpdateData } | { error: string } {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return { error: "Title is required" };

  const times = parseEventTimes({ startDate: body.startDate, startTime: body.startTime, endDate: body.endDate, endTime: body.endTime });
  if (times.error !== undefined) return { error: times.error };
  if (!isValidRecurrence(body.recurrence)) return { error: "Invalid recurrence" };
  const recurrence = normalizeRecurrence(body.recurrence);
  const repeatUntil = parseRepeatUntil({ startDate: body.startDate, repeatUntil: body.repeatUntil }, recurrence !== "NONE");
  if (repeatUntil.error !== undefined) return { error: repeatUntil.error };

  return {
    data: {
      title,
      description: optionalText(body.description),
      location: optionalText(body.location),
      times: times.value,
      recurrence,
      // A request without the field leaves the date as it is (unless the event stops repeating).
      repeatUntil: recurrence === "NONE" || body.repeatUntil !== undefined ? repeatUntil.value : undefined,
      projectId: optionalText(body.projectId),
    },
  };
}
