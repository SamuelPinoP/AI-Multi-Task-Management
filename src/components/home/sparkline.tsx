import { sparklinePaths } from "@/lib/home-summary";

/** A 7-day trend line; the label says what the values are for screen readers. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const { line, area, last } = sparklinePaths(values);

  return (
    <svg viewBox="0 0 72 26" className="h-[26px] w-[72px] shrink-0 overflow-visible" role="img" aria-label={label}>
      <path d={area} className="fill-accent-soft" />
      <path d={line} className="fill-none stroke-accent" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last.x} cy={last.y} r={2.2} className="fill-accent" />
    </svg>
  );
}
