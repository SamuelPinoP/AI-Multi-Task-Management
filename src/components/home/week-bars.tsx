import { cn } from "@/lib/cn";
import { barHeights, describeWeek, weekDayLabels } from "@/lib/home-summary";

/**
 * A 7-day bar chart, oldest first, with today in the accent (DES-10). Each bar
 * has a tooltip, and the label says what the chart shows and lists the values.
 */
export function WeekBars({ values, now, label }: { values: number[]; now: Date; label: string }) {
  const days = weekDayLabels(now, values.length);

  return (
    <span role="img" aria-label={`${label}: ${describeWeek(values, now)}`} className="flex h-5 shrink-0 items-end gap-0.5 sm:h-7">
      {barHeights(values).map((height, index) => (
        <span key={days[index]} title={`${days[index]}: ${values[index]}`} className="flex h-full w-[5px] items-end sm:w-1.5">
          <span
            className={cn("w-full rounded-t-[2px]", index === values.length - 1 ? "bg-accent" : "bg-muted/75")}
            style={{ height: `max(2px, ${Math.round(height * 100)}%)` }}
          />
        </span>
      ))}
    </span>
  );
}
