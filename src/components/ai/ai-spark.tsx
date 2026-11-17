import { cn } from "@/lib/cn";

/**
 * The AI's mark (#308, icon 1 on the round-3 canvas): two filled stars, the big one in the accent
 * and the small one in --ai-spark, so it follows the person's accent color in both themes. Only
 * the AI uses sparkles. Decorative: the control around it carries the name.
 */
export function AiSpark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={cn("h-4.5 w-4.5 shrink-0", className)}>
      <path
        className="fill-accent"
        d="M10.5 4.5C11.2 10.1 12.9 11.8 18.5 12.5C12.9 13.2 11.2 14.9 10.5 20.5C9.8 14.9 8.1 13.2 2.5 12.5C8.1 11.8 9.8 10.1 10.5 4.5Z"
      />
      <path
        className="fill-ai-spark"
        d="M19 2.5C19.3 4.4 19.6 4.7 21.5 5C19.6 5.3 19.3 5.6 19 7.5C18.7 5.6 18.4 5.3 16.5 5C18.4 4.7 18.7 4.4 19 2.5Z"
      />
    </svg>
  );
}
