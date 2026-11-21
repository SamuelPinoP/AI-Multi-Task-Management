import "server-only";

// What the shared create and update functions return (#310): the result, or the status and
// message of a refusal for the route to send, plus the work that waits until the change is
// committed. Routes run that work right away; a transaction runs it once it has committed.
import { after } from "next/server";
import { refreshCalendarFeeds } from "@/lib/calendar-feed-store";
import type { FeedScope } from "@/lib/calendar-feed-store-core";
import { notifyTaskAssigned } from "@/lib/notifications";

/**
 * Who makes a change: the signed-in person, from their session. `via` is set when they made it
 * through the AI assistant, by applying its proposal (#310), and Activity says so.
 */
export type WriteActor = { id: string; name: string | null; email: string; via?: "AI Multi" };

/** An Activity message as the actor made it: "Created task: “X” via AI Multi" for the AI's changes. */
export function activityText(message: string, actor: WriteActor) {
  return actor.via ? `${message} via ${actor.via}` : message;
}

/** Work for after a change is committed. */
export type FollowUp = {
  /** The calendar feeds that show what changed. */
  feeds?: FeedScope;
  /** A task with a new assignee, who hears about it in their inbox (SMART-08). */
  assigned?: Parameters<typeof notifyTaskAssigned>[0]["task"];
};

export type WriteRefusal = { ok: false; status: 400 | 403 | 404; error: string };

export type WriteResult<Value> = { ok: true; value: Value; followUp: FollowUp } | WriteRefusal;

export function refuse(status: WriteRefusal["status"], error: string): WriteRefusal {
  return { ok: false, status, error };
}

/** Runs the follow-ups of committed changes: both happen after the response is sent. */
export function runFollowUps(actor: WriteActor, followUps: FollowUp[]) {
  for (const { feeds, assigned } of followUps) {
    if (feeds) refreshCalendarFeeds(feeds);
    if (assigned) after(() => notifyTaskAssigned({ task: assigned, actor }));
  }
}
