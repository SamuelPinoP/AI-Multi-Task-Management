"use client";

import { uiPrimaryButtonClass } from "@/components/ui";

export default function PlannerError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-screen px-4 py-8 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-2xl rounded-3xl border border-red-200 bg-red-50 p-6 text-red-900 shadow-sm dark:border-red-950 dark:bg-red-950/30 dark:text-red-100">
        <h1 className="text-2xl font-bold">Smart Planner could not load</h1>
        <p className="mt-2 text-sm leading-6">Please try again. If the issue continues, check your database connection and server logs.</p>
        <button type="button" onClick={reset} className={`${uiPrimaryButtonClass} mt-4`}>Retry</button>
      </section>
    </main>
  );
}
