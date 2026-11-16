// When no model can answer (a cap is used up, the provider fails, or no key is
// set), the rule-based planner (src/lib/smart-planner.ts) answers instead, and
// the person is told why (#307).
import { untilReset, type Allowance } from "@/lib/ai/allowance";
import type { Source } from "@/lib/ai/tools/define";
import type { PlannerSectionKey, PlannerSuggestion, PlannerSuggestionKind, SmartPlanner } from "@/lib/smart-planner";

export type FallbackReason = "user_limit" | "app_limit" | "rate_limited" | "unavailable" | "timeout" | "disabled" | "region";

export function fallbackMessage(reason: FallbackReason, allowance: Allowance, now: Date) {
  switch (reason) {
    case "user_limit":
      return `You've used today's AI allowance of ${allowance.user.limit} requests. It resets in ${untilReset(allowance, now)}. Until then, here's what your planner suggests.`;
    case "app_limit":
      return `The AI assistant has reached today's limit for everyone. It resets in ${untilReset(allowance, now)}. Until then, here's what your planner suggests.`;
    case "rate_limited":
      return "The AI service is busy right now. Try again in a minute. Meanwhile, here's what your planner suggests.";
    case "timeout":
      return "The AI service took too long to answer. Here's what your planner suggests instead.";
    case "unavailable":
      return "The AI service isn't answering right now. Here's what your planner suggests instead.";
    case "disabled":
      return "The AI assistant isn't available here. Here's what your planner suggests instead.";
    case "region":
      return "The AI assistant isn't available in your country yet. Here's what your planner suggests instead.";
  }
}

const SECTION_ORDER: PlannerSectionKey[] = ["urgent", "dueToday", "upcoming", "projectFollowUp", "suggestedFocus"];
const MAX_SUGGESTIONS = 6;
const SOURCE_KINDS: Partial<Record<PlannerSuggestionKind, Source["kind"]>> = { TASK: "task", EVENT: "event", PROJECT: "project", NOTE: "note" };

/** The planner's most pressing suggestions, one line each, with links to the items. */
export function plannerAnswer(planner: Pick<SmartPlanner, "sections">): { text: string; sources: Source[] } {
  const seen = new Set<string>();
  const picked: PlannerSuggestion[] = [];
  for (const key of SECTION_ORDER) {
    for (const suggestion of planner.sections.find((section) => section.key === key)?.suggestions ?? []) {
      // A repeating event or a busy project shows up more than once; list each item once.
      const item = suggestion.related ? `${suggestion.related.type}:${suggestion.related.id}` : suggestion.id;
      if (picked.length >= MAX_SUGGESTIONS || seen.has(item)) continue;
      seen.add(item);
      picked.push(suggestion);
    }
  }
  if (picked.length === 0) {
    return { text: "Nothing is pressing: no overdue tasks, nothing due today and nothing coming up this week.", sources: [] };
  }

  const sources = picked.flatMap((suggestion): Source[] => {
    const kind = suggestion.related ? SOURCE_KINDS[suggestion.related.type] : undefined;
    return kind && suggestion.related && suggestion.actionHref
      ? [{ kind, id: suggestion.related.id, title: suggestion.title, href: suggestion.actionHref }]
      : [];
  });
  return { text: picked.map((suggestion) => `- ${suggestion.title}: ${suggestion.reason}`).join("\n"), sources };
}
