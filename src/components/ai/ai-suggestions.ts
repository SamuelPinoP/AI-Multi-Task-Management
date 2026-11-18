import { CalendarDays, ChartColumn, ListTodo, type LucideIcon } from "lucide-react";

/**
 * Questions a new chat offers to start from, on the AI page and in the AI bar's chat (#308). The
 * round-3 canvas also shows a task and an event; those come back once the assistant can draft
 * them (#310). Until then it only looks things up.
 */
export const AI_SUGGESTIONS: Array<{ text: string; icon: LucideIcon }> = [
  { text: "What's overdue?", icon: ListTodo },
  { text: "What analytics can you give?", icon: ChartColumn },
  { text: "What's on my calendar this week?", icon: CalendarDays },
];
