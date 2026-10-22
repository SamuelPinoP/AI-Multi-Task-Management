/**
 * Project templates (SMART-11): a new project can start with tasks (some with
 * subtasks or a weekly repeat), its board already filled in, and recurring
 * check-ins on the calendar. Dates are offsets from the day the project is
 * created, in the user's time zone. No server-only imports: the New project
 * sheet shows the same list.
 */

type Priority = "LOW" | "MEDIUM" | "HIGH";
type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
type Recurrence = "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";

type TemplateTask = {
  title: string;
  /** Days from the creation date; none means no due date. */
  dueInDays?: number;
  priority?: Priority;
  status?: TaskStatus;
  /** A repeating task, e.g. "Apply to five roles" every week. */
  recurrence?: Recurrence;
  subtasks?: string[];
};

type TemplateCheckIn = {
  title: string;
  description: string;
  recurrence: Recurrence;
  firstInDays: number;
  /** Wall-clock start, "HH:MM". */
  start: string;
  durationMinutes: number;
  /** The last day a repeat can start on, in days from creation; none keeps repeating. */
  repeatForDays?: number;
};

export type ProjectTemplate = {
  id: string;
  name: string;
  /** One line for the template picker. */
  summary: string;
  description: string;
  color: string;
  tasks: TemplateTask[];
  checkIns: TemplateCheckIn[];
};

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "capstone",
    name: "Capstone",
    summary: "Twelve weeks from problem statement to final presentation, with weekly advisor check-ins.",
    description: "Capstone project: from the problem statement to the final presentation.",
    color: "#7c3aed",
    tasks: [
      { title: "Write the problem statement", dueInDays: 3, priority: "HIGH" },
      { title: "Agree on the scope with your advisor", dueInDays: 7, priority: "HIGH" },
      { title: "Make a plan with milestones", dueInDays: 14 },
      {
        title: "Literature review",
        dueInDays: 21,
        subtasks: ["Collect ten sources", "Summarize each source", "Write the review section"],
      },
      { title: "Build the first prototype", dueInDays: 42, priority: "HIGH" },
      { title: "Midpoint review", dueInDays: 49 },
      { title: "Test and evaluate", dueInDays: 63, subtasks: ["Plan the evaluation", "Run it", "Write up the results"] },
      {
        title: "Write the final report",
        dueInDays: 77,
        priority: "HIGH",
        subtasks: ["First draft", "Revise with feedback", "Proofread"],
      },
      { title: "Prepare the slides and the demo", dueInDays: 81 },
      { title: "Final presentation", dueInDays: 84, priority: "HIGH" },
    ],
    checkIns: [
      {
        title: "Advisor check-in",
        description: "Progress since last time, blockers, and the plan for next week.",
        recurrence: "WEEKLY",
        firstInDays: 7,
        start: "10:00",
        durationMinutes: 30,
        repeatForDays: 84,
      },
    ],
  },
  {
    id: "sprint",
    name: "Sprint",
    summary: "A two-week sprint: goal, plan, demo and retrospective, with a weekly team sync.",
    description: "Two-week sprint. Keep the goal small enough to demo at the end.",
    color: "#2563eb",
    tasks: [
      { title: "Set the sprint goal", dueInDays: 0, priority: "HIGH", status: "IN_PROGRESS" },
      { title: "Break the top stories into tasks", dueInDays: 1 },
      { title: "Estimate and assign the work", dueInDays: 1 },
      { title: "Freeze the scope and test", dueInDays: 11 },
      { title: "Prepare the demo", dueInDays: 12 },
      { title: "Sprint review", dueInDays: 13, priority: "HIGH" },
      { title: "Retrospective and the next sprint's goal", dueInDays: 14 },
    ],
    checkIns: [
      {
        title: "Team sync",
        description: "What moved, what's stuck, and what changes in the plan.",
        recurrence: "WEEKLY",
        firstInDays: 1,
        start: "09:30",
        durationMinutes: 15,
        repeatForDays: 14,
      },
      {
        title: "Sprint review and demo",
        description: "Show what's done against the sprint goal.",
        recurrence: "NONE",
        firstInDays: 13,
        start: "15:00",
        durationMinutes: 60,
      },
    ],
  },
  {
    id: "job-search",
    name: "Job search",
    summary: "Résumé, target list and referrals, then weekly applications and interview practice.",
    description: "Job search: a steady weekly routine beats bursts.",
    color: "#d97706",
    tasks: [
      { title: "Update your résumé", dueInDays: 3, priority: "HIGH" },
      { title: "Refresh your LinkedIn profile", dueInDays: 5 },
      { title: "List 20 companies you'd like to work for", dueInDays: 7 },
      { title: "Write a cover letter you can adapt", dueInDays: 7 },
      { title: "Ask three people for referrals", dueInDays: 10 },
      { title: "Apply to five roles", dueInDays: 7, recurrence: "WEEKLY" },
      { title: "Practice two interview questions", dueInDays: 4, recurrence: "WEEKLY" },
      { title: "Follow up on last week's applications", dueInDays: 14, recurrence: "WEEKLY" },
    ],
    checkIns: [
      {
        title: "Weekly job search review",
        description: "Applications sent, replies, interviews, and next week's targets.",
        recurrence: "WEEKLY",
        firstInDays: 7,
        start: "17:00",
        durationMinutes: 30,
      },
    ],
  },
];

export function findProjectTemplate(id: unknown) {
  if (typeof id !== "string") return null;
  return PROJECT_TEMPLATES.find((template) => template.id === id) ?? null;
}

/** "Adds 10 tasks and a weekly check-in", for the picker. */
export function describeTemplateContents(template: ProjectTemplate) {
  const tasks = `${template.tasks.length} tasks`;
  const repeating = template.checkIns.filter((checkIn) => checkIn.recurrence !== "NONE").length;
  if (!repeating) return `Adds ${tasks}`;
  return `Adds ${tasks} and ${repeating === 1 ? "a recurring check-in" : `${repeating} recurring check-ins`}`;
}

export type CalendarDay = { year: number; month: number; day: number };

export type PlannedTask = {
  title: string;
  priority: Priority;
  status: TaskStatus;
  recurrence: Recurrence;
  /** "YYYY-MM-DD", or null for no due date. */
  dueDate: string | null;
  subtasks: string[];
};

/** Event fields in the same shape the Events form sends (see parseEventTimes). */
export type PlannedEvent = {
  title: string;
  description: string;
  recurrence: Recurrence;
  startDate: string;
  startTime: string;
  /** Always null: check-ins end on the day they start. */
  endDate: null;
  endTime: string;
  repeatUntil: string | null;
};

function dayKey(today: CalendarDay, offset: number) {
  const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
  return date.toISOString().slice(0, 10);
}

function addMinutes(time: string, minutes: number) {
  const [hours, mins] = time.split(":").map(Number);
  // Check-ins end the same day; templates keep them short.
  const total = Math.min(hours * 60 + mins + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** The tasks and events a template creates when the project starts on `today`. */
export function planTemplate(template: ProjectTemplate, today: CalendarDay): { tasks: PlannedTask[]; events: PlannedEvent[] } {
  return {
    tasks: template.tasks.map((task) => ({
      title: task.title,
      priority: task.priority ?? "MEDIUM",
      status: task.status ?? "TODO",
      recurrence: task.recurrence ?? "NONE",
      dueDate: task.dueInDays === undefined ? null : dayKey(today, task.dueInDays),
      subtasks: task.subtasks ?? [],
    })),
    events: template.checkIns.map((checkIn) => ({
      title: checkIn.title,
      description: checkIn.description,
      recurrence: checkIn.recurrence,
      startDate: dayKey(today, checkIn.firstInDays),
      startTime: checkIn.start,
      endDate: null,
      endTime: addMinutes(checkIn.start, checkIn.durationMinutes),
      repeatUntil:
        checkIn.recurrence === "NONE" || checkIn.repeatForDays === undefined ? null : dayKey(today, checkIn.repeatForDays),
    })),
  };
}
