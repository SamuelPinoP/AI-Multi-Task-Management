"use client";

import { uiButtonClass } from "@/components/ui";

export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50/80 p-6 shadow-sm dark:border-red-900/60 dark:bg-red-950/20">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-red-700 dark:text-red-300">
          Dashboard error
        </p>
        <h1 className="mt-2 text-3xl font-bold text-zinc-950 dark:text-zinc-50">
          We couldn&apos;t load your analytics.
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
          Your notes, tasks, projects, and events are still safe. Try loading
          the dashboard again; if the problem continues, check the server logs.
        </p>
        <button type="button" onClick={reset} className={`${uiButtonClass} mt-5`}>
          Retry dashboard
        </button>
      </div>
    </main>
  );
}
