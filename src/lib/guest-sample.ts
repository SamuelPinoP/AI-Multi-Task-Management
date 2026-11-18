import "server-only";
import { parseEventTimes } from "@/lib/event-time";
import { sampleSchedule } from "@/lib/guest-sample-core";
import { prisma } from "@/lib/prisma";
import { parseTaskDueDateForStorage } from "@/lib/task-date-buckets";

function eventTimes(slot: { date: string; start: string; end: string }) {
  const times = parseEventTimes({ startDate: slot.date, startTime: slot.start, endDate: slot.date, endTime: slot.end });
  // Unit tests keep the schedule valid; this guards against a bad edit.
  if (!times.value) throw new Error(`Invalid sample event time: ${times.error}`);
  return times.value;
}

/**
 * Fills a new guest workspace with a small, believable sample (#460), so a visitor sees Home, the
 * calendar and boards working before making anything: two projects, five tasks around today, a
 * design review and a weekly standup, and a note. All of it is starter content, so the guest's
 * limits count none of it, and it can be deleted like anything else.
 */
export async function seedGuestSample(userId: string, timeZone: string, now = new Date()) {
  const plan = sampleSchedule(now, timeZone);
  const due = (date: string) => parseTaskDueDateForStorage(date);
  const starter = { userId, isStarter: true };

  await prisma.$transaction(async (tx) => {
    const website = await tx.project.create({
      data: { ...starter, name: "Launch website", color: "#0f9488", description: "The new site, from the domain to the launch post." },
    });
    const app = await tx.project.create({ data: { ...starter, name: "Mobile app", color: "#d97706" } });

    await tx.task.createMany({
      data: [
        { ...starter, title: "Fix the signup form", priority: "HIGH", dueDate: due(plan.yesterday), projectId: website.id },
        { ...starter, title: "Write the launch post", priority: "HIGH", dueDate: due(plan.today), projectId: website.id },
        { ...starter, title: "Review open pull requests", priority: "MEDIUM", status: "IN_PROGRESS", dueDate: due(plan.today), projectId: app.id },
        { ...starter, title: "Plan the next sprint", priority: "LOW", dueDate: due(plan.tomorrow) },
      ],
    });
    const done = await tx.task.create({
      data: { ...starter, title: "Set up the domain", priority: "MEDIUM", status: "DONE", completedAt: now, projectId: website.id },
    });

    await tx.event.create({ data: { ...starter, ...eventTimes(plan.review), title: "Design review", projectId: website.id } });
    await tx.event.create({ data: { ...starter, ...eventTimes(plan.standup), title: "Team standup", recurrence: "WEEKLY", projectId: app.id } });
    const note = await tx.note.create({
      data: { ...starter, title: "Launch checklist", content: "Domain, analytics, the launch post and a last pass on the signup form.", projectId: website.id },
    });

    // Home's Activity card, so the workspace looks lived in.
    await tx.activity.createMany({
      data: [
        { userId, action: "COMPLETED_TASK", message: `Completed task: “${done.title}”`, entityType: "TASK", entityId: done.id, projectId: website.id },
        { userId, action: "CREATED_NOTE", message: `Created note: “${note.title}”`, entityType: "NOTE", entityId: note.id, projectId: website.id },
      ],
    });
  });
}
