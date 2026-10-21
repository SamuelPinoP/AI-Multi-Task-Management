"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export type BurnUpChartPoint = { date: string; scope: number; done: number };

const HEIGHT = 180;
const MARGIN = { top: 14, right: 40, bottom: 26, left: 30 };
const series = [
  { key: "done", label: "Done", color: "var(--chart-done)" },
  { key: "scope", label: "All tasks", color: "var(--chart-scope)" },
] as const;

const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function formatDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return dayFormat.format(new Date(year, month - 1, day));
}

/** 0 to an even number at or above the largest value, so the middle tick is a whole number. */
function niceMax(value: number) {
  return Math.max(2, Math.ceil(value / 2) * 2);
}

/**
 * Burn-up chart (SMART-03): all tasks against done tasks over time. A gap
 * between the lines is work left; the lines meet when everything is done.
 * Hover or use the arrow keys for a day's numbers; the table below has them all.
 */
export function BurnUpChart({ points, caption }: { points: BurnUpChartPoint[]; caption: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const last = points.length - 1;
  const yMax = niceMax(Math.max(...points.map((point) => point.scope), 0));
  const plotWidth = Math.max(0, (width ?? 0) - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (index: number) => MARGIN.left + (last > 0 ? (index / last) * plotWidth : plotWidth);
  const y = (value: number) => MARGIN.top + plotHeight - (value / yMax) * plotHeight;
  const linePath = (key: "done" | "scope") =>
    points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(" ");
  const doneArea = `${linePath("done")} L${x(last).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;

  const end = points[last];
  // Direct labels at the line ends; when they'd overlap, the legend and tooltip carry the second.
  const endLabelsCollide = Math.abs(y(end.scope) - y(end.done)) < 14;
  const middle = Math.floor(last / 2);
  const xTicks = last >= 2 ? [0, middle, last] : [0, last];

  function indexAt(clientX: number, target: Element) {
    const bounds = target.getBoundingClientRect();
    const ratio = (clientX - bounds.left - MARGIN.left) / Math.max(plotWidth, 1);
    return Math.min(last, Math.max(0, Math.round(ratio * last)));
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    const current = active ?? last;
    if (event.key === "ArrowLeft") setActive(Math.max(0, current - 1));
    else if (event.key === "ArrowRight") setActive(Math.min(last, current + 1));
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(last);
    else if (event.key === "Escape") setActive(null);
    else return;
    event.preventDefault();
  }

  const shown = active === null ? null : points[active];
  const tooltipLeft = active === null ? 0 : Math.min(Math.max(x(active) - 70, 0), Math.max((width ?? 0) - 140, 0));

  return (
    <figure className="grid min-w-0 gap-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
        {series.map((item) => (
          <li key={item.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0.5 w-4 rounded-full" style={{ backgroundColor: item.color }} />
            {item.label}
          </li>
        ))}
      </ul>
      <div
        ref={containerRef}
        className="relative rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent"
        style={{ height: HEIGHT }}
        tabIndex={0}
        role="group"
        aria-label={`${caption}. Use the arrow keys to read each point.`}
        onKeyDown={handleKey}
        onFocus={() => setActive((current) => current ?? last)}
        onBlur={() => setActive(null)}
      >
        {width ? (
          // Absolute, so the old width never holds the card open while it shrinks.
          <svg width={width} height={HEIGHT} aria-hidden="true" className="absolute left-0 top-0 overflow-visible">
            {[0, yMax / 2, yMax].map((tick) => (
              <g key={tick}>
                <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(tick)} y2={y(tick)} stroke="var(--line)" strokeWidth={1} />
                <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                  {tick}
                </text>
              </g>
            ))}
            {xTicks.map((index) => (
              <text
                key={index}
                x={x(index)}
                y={HEIGHT - 6}
                textAnchor={index === 0 ? "start" : index === last ? "end" : "middle"}
                className="fill-muted text-[11px]"
              >
                {index === last ? "Today" : formatDay(points[index].date)}
              </text>
            ))}
            <path d={doneArea} fill="var(--chart-done)" fillOpacity={0.1} />
            <path d={linePath("scope")} fill="none" stroke="var(--chart-scope)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <path d={linePath("done")} fill="none" stroke="var(--chart-done)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {active !== null ? (
              <line x1={x(active)} x2={x(active)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke="var(--muted)" strokeWidth={1} />
            ) : null}
            {series.map((item) => {
              const index = active ?? last;
              return (
                <circle
                  key={item.key}
                  cx={x(index)}
                  cy={y(points[index][item.key])}
                  r={4}
                  fill={item.color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              );
            })}
            <text x={x(last) + 8} y={y(end.done)} dy="0.32em" className="fill-ink text-[11px] font-semibold tabular-nums">
              {end.done}
            </text>
            {endLabelsCollide ? null : (
              <text x={x(last) + 8} y={y(end.scope)} dy="0.32em" className="fill-ink text-[11px] font-semibold tabular-nums">
                {end.scope}
              </text>
            )}
            <rect
              x={MARGIN.left}
              y={0}
              width={plotWidth}
              height={HEIGHT}
              fill="transparent"
              onPointerMove={(event: PointerEvent<SVGRectElement>) => setActive(indexAt(event.clientX, event.currentTarget.ownerSVGElement ?? event.currentTarget))}
              onPointerLeave={() => setActive(null)}
            />
          </svg>
        ) : null}
        {shown ? (
          <div
            role="status"
            className="pointer-events-none absolute top-0 w-[140px] rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: tooltipLeft }}
          >
            <p className="font-semibold">{active === last ? "Today" : formatDay(shown.date)}</p>
            {series.map((item) => (
              <p key={item.key} className="mt-0.5 flex items-center gap-1.5 text-muted">
                <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="flex-1">{item.label}</span>
                <span className="font-semibold tabular-nums text-ink">{shown[item.key]}</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <figcaption className="sr-only">{caption}</figcaption>
      <details className="text-xs text-muted">
        <summary className="w-fit cursor-pointer rounded hover:text-ink">Show as a table</summary>
        <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-line" tabIndex={0} role="region" aria-label="Burn-up data">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-sunken text-muted">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-semibold">Date</th>
                <th scope="col" className="px-3 py-1.5 text-right font-semibold">Done</th>
                <th scope="col" className="px-3 py-1.5 text-right font-semibold">All tasks</th>
              </tr>
            </thead>
            <tbody className="text-ink">
              {points.map((point, index) => (
                <tr key={point.date} className="border-t border-line">
                  <td className="px-3 py-1">{index === last ? "Today" : formatDay(point.date)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{point.done}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{point.scope}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
