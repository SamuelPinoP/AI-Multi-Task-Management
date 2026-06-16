import { uiCardClass } from "@/components/ui";

export default function PlannerLoading() {
  return (
    <main className="min-h-screen px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="h-48 animate-pulse rounded-[2rem] bg-zinc-200 dark:bg-zinc-800" />
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />)}
        </section>
        <section className={uiCardClass}>
          <div className="h-8 w-56 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="mt-5 space-y-3">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />)}</div>
        </section>
      </div>
    </main>
  );
}
