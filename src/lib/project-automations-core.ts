/**
 * Project automations (SMART-11): "when <trigger>, <action>" rules an owner
 * turns on per project. The pure parts: which pairs exist, how they read, and
 * when they apply. The database and email side is in project-automations.ts.
 */

export type AutomationTrigger = "TASK_CREATED" | "TASK_COMPLETED";
export type AutomationAction = "EMAIL_OWNER" | "ASSIGN_MEMBER";

type Recipe = { trigger: AutomationTrigger; action: AutomationAction; label: string };

/** Every rule an owner can add, in the order the picker shows them. */
export const AUTOMATION_RECIPES: readonly Recipe[] = [
  { trigger: "TASK_COMPLETED", action: "EMAIL_OWNER", label: "When a task moves to Done, email the project owner" },
  { trigger: "TASK_CREATED", action: "EMAIL_OWNER", label: "When a task is added, email the project owner" },
  { trigger: "TASK_CREATED", action: "ASSIGN_MEMBER", label: "When a task is added without an assignee, assign it to a member" },
];

export function recipeKey(trigger: AutomationTrigger, action: AutomationAction) {
  return `${trigger}:${action}`;
}

export function findRecipe(trigger: unknown, action: unknown) {
  return AUTOMATION_RECIPES.find((recipe) => recipe.trigger === trigger && recipe.action === action) ?? null;
}

/** Reads a POST body: `{ trigger, action, memberId? }`. */
export function parseAutomationInput(
  body: unknown,
): { trigger: AutomationTrigger; action: AutomationAction; memberId: string | null } | { error: string } {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const recipe = findRecipe(input.trigger, input.action);
  if (!recipe) return { error: "Choose one of the listed rules." };
  const memberId = typeof input.memberId === "string" && input.memberId.trim() ? input.memberId.trim() : null;
  if (recipe.action === "ASSIGN_MEMBER" && !memberId) return { error: "Choose who gets new tasks." };
  return { trigger: recipe.trigger, action: recipe.action, memberId: recipe.action === "ASSIGN_MEMBER" ? memberId : null };
}

/** The sentence a rule shows on the project page. */
export function describeAutomation(rule: { trigger: AutomationTrigger; action: AutomationAction; memberName?: string | null }) {
  if (rule.action === "ASSIGN_MEMBER") {
    return `When a task is added without an assignee, assign it to ${rule.memberName?.trim() || "a removed member"}`;
  }
  return findRecipe(rule.trigger, rule.action)?.label ?? "Unknown rule";
}

/** Owners aren't emailed about their own changes, and guest workspaces have no inbox. */
export function shouldEmailOwner(owner: { id: string; isGuest: boolean }, actorId: string) {
  return owner.id !== actorId && !owner.isGuest;
}

/**
 * The member a new task goes to: the one it was created with, or else the
 * first enabled "assign new tasks" rule's member. Subtasks keep what they're
 * given, so a parent's rule doesn't spread to every checklist item.
 */
export function automaticAssignee(
  rules: { action: AutomationAction; trigger: AutomationTrigger; enabled: boolean; memberId: string | null }[],
  task: { assigneeId: string | null; isSubtask: boolean },
) {
  if (task.assigneeId || task.isSubtask) return task.assigneeId;
  const rule = rules.find((item) => item.enabled && item.trigger === "TASK_CREATED" && item.action === "ASSIGN_MEMBER" && item.memberId);
  return rule?.memberId ?? null;
}
