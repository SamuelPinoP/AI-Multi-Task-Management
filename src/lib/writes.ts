import "server-only";

// What the shared create and update functions return (#310): the result, or the status and
// message of a refusal for the route to send, plus the work that waits until the change is
// committed. Routes run that work right away; a transaction runs it once it has committed.
import { after } from "next/server";
import { mergeFollowUps, type EstimateFollowUp } from "@/lib/ai/estimate-core";
import { estimateSubtasks } from "@/lib/ai/estimate-server";
import { refreshCalendarFeeds } from "@/lib/calendar-feed-store";
import type { FeedScope } from "@/lib/calendar-feed-store-core";
import { notifyTaskAssigned, notifyTaskComment } from "@/lib/notifications";

/**
 * Who makes a change: the signed-in person, from their session. `via` names what they made it
 * through when it wasn't the app itself: "AI Multi" when they applied the in-app assistant's
 * proposal (#310), or a connected AI app's name as they approved it, such as "Claude", for its
 * changes over MCP (#479). Activity and the task's history say so.
 */
export type WriteActor = { id: string; name: string | null; email: string; via?: string };

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
  /** A new comment, which the people it mentions and the task's assignee hear about (#279). */
  commented?: Parameters<typeof notifyTaskComment>[0];
  /** Subtasks that follow their parent's estimate (#540): a new one under a task with an estimate, or a task's that just got one. */
  estimate?: EstimateFollowUp;
};

export type WriteRefusal = { ok: false; status: 400 | 403 | 404 | 429; error: string };

export type WriteResult<Value> = { ok: true; value: Value; followUp: FollowUp } | WriteRefusal;

export function refuse(status: WriteRefusal["status"], error: string): WriteRefusal {
  return { ok: false, status, error };
}

/**
 * Where a change was made from, for the follow-ups that send something to the AI: the person's
 * country (Vercel's `x-vercel-ip-country`), which decides whether the free tier may serve them.
 */
export type ChangeOrigin = { country: string | null };

/** A route's request as a change's origin. Vercel sets the header, so a client can't choose it. */
export function changeOrigin(request: Request): ChangeOrigin {
  return { country: request.headers.get("x-vercel-ip-country") };
}

/**
 * Runs the follow-ups of committed changes: all of them happen after the response is sent.
 * Subtasks' estimates (#540) need `origin`: changes made in the app and through its AI assistant
 * pass it. AI apps' changes over MCP don't, since their requests come from the app's servers, not
 * from where the person is, so their subtasks get none.
 */
export function runFollowUps(actor: WriteActor, followUps: FollowUp[], origin?: ChangeOrigin) {
  for (const { feeds, assigned, commented } of followUps) {
    if (feeds) refreshCalendarFeeds(feeds);
    if (assigned) after(() => notifyTaskAssigned({ task: assigned, actor }));
    if (commented) after(() => notifyTaskComment(commented));
  }
  if (!origin) return;
  for (const estimate of mergeFollowUps(followUps.flatMap((followUp) => (followUp.estimate ? [followUp.estimate] : [])))) {
    after(() => estimateSubtasks(actor.id, estimate, origin.country));
  }
}
