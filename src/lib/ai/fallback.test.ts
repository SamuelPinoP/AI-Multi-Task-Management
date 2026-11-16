import assert from "node:assert/strict";
import test from "node:test";
import type { PlannerSection, PlannerSectionKey, PlannerSuggestion } from "../smart-planner";
import { allowanceFor } from "./allowance";
import { fallbackMessage, plannerAnswer } from "./fallback";

function suggestion(id: string, type: PlannerSuggestion["kind"], relatedId: string, href: string | undefined, title = `Item ${id}`): PlannerSuggestion {
  return {
    id,
    title,
    reason: `Reason ${id}.`,
    priority: "HIGH",
    kind: type,
    related: { type: type === "ACTIVITY" ? "PROJECT" : type, id: relatedId, label: "" },
    actionHref: href,
    canCreateTask: false,
  };
}

function planner(sections: Partial<Record<PlannerSectionKey, PlannerSuggestion[]>>) {
  return {
    sections: Object.entries(sections).map(([key, suggestions]): PlannerSection => ({ key: key as PlannerSectionKey, title: key, description: "", suggestions })),
  };
}

test("lists the most pressing suggestions once each, with links", () => {
  const answer = plannerAnswer(
    planner({
      suggestedFocus: [suggestion("task-t1-again", "TASK", "t1", "/tasks?task=t1"), suggestion("note-n1", "NOTE", "n1", "/notes?openNote=n1")],
      urgent: [suggestion("task-t1", "TASK", "t1", "/tasks?task=t1", "Pay rent")],
      dueToday: [suggestion("task-t2", "TASK", "t2", "/tasks?task=t2")],
      upcoming: [
        suggestion("event-e1-1", "EVENT", "e1", "/events?event=e1", "Standup"),
        suggestion("event-e1-2", "EVENT", "e1", "/events?event=e1", "Standup"),
      ],
      projectFollowUp: [suggestion("project-p1", "PROJECT", "p1", "/projects/p1"), suggestion("comment-c1", "ACTIVITY", "p1", "/projects/p1/chat")],
    }),
  );
  assert.equal(answer.text, ["- Pay rent: Reason task-t1.", "- Item task-t2: Reason task-t2.", "- Standup: Reason event-e1-1.", "- Item project-p1: Reason project-p1.", "- Item note-n1: Reason note-n1."].join("\n"));
  assert.deepEqual(
    answer.sources.map((source) => `${source.kind}:${source.id}`),
    ["task:t1", "task:t2", "event:e1", "project:p1", "note:n1"],
  );
});

test("at most six, and only items it can link to become sources", () => {
  const many = Array.from({ length: 9 }, (_, index) => suggestion(`task-${index}`, "TASK", `t${index}`, index === 0 ? undefined : `/tasks?task=t${index}`));
  const answer = plannerAnswer(planner({ urgent: many }));
  assert.equal(answer.text.split("\n").length, 6);
  assert.equal(answer.sources.length, 5);
});

test("an empty planner says nothing is pressing", () => {
  assert.deepEqual(plannerAnswer(planner({})), {
    text: "Nothing is pressing: no overdue tasks, nothing due today and nothing coming up this week.",
    sources: [],
  });
});

test("says why the planner is answering", () => {
  const now = new Date("2026-11-16T15:00:00Z");
  const allowance = allowanceFor({ user: 40, app: 40 }, { userDailyRequests: 40, appDailyRequests: 400 }, now);
  assert.equal(
    fallbackMessage("user_limit", allowance, now),
    "You've used today's AI allowance of 40 requests. It resets in about 17 hours. Until then, here's what your planner suggests.",
  );
  assert.equal(fallbackMessage("timeout", allowance, now), "The AI service took too long to answer. Here's what your planner suggests instead.");
});
