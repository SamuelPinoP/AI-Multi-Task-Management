export default function Loading() {
  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="space-y-3">
          <div className="h-4 w-28 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-10 w-56 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-5 w-full max-w-xl animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
        </div>
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              className="rounded-2xl border border-zinc-200 bg-white/95 p-5 shadow-sm shadow-zinc-200/60 dark:border-zinc-800 dark:bg-zinc-900/70 dark:shadow-none"
            >
              <div className="h-4 w-24 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
              <div className="mt-3 h-9 w-16 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
              <div className="mt-4 h-4 w-full animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
              <div className="mt-2 h-4 w-2/3 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
            </div>
          ))}
        </section>
        <div className="rounded-2xl border border-zinc-200 bg-white/95 p-6 shadow-sm shadow-zinc-200/60 dark:border-zinc-800 dark:bg-zinc-900/70 dark:shadow-none">
          <div className="h-7 w-40 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => (
              <div
                key={index}
                className="h-28 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800/70"
              />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
