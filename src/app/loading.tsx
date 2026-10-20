const pulse = "animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800";

function CardSkeleton({ rows }: { rows: number }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className={`${pulse} h-4 w-24`} />
      <div className="mt-3 grid gap-2.5">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className={`${pulse} h-4 w-full`} />
        ))}
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-5 sm:px-6 lg:px-8 lg:py-6" aria-busy="true" aria-label="Loading">
      <div className="grid gap-2">
        <div className={`${pulse} h-3 w-32`} />
        <div className={`${pulse} h-7 w-64`} />
        <div className={`${pulse} h-4 w-full max-w-md`} />
      </div>
      <div className="h-11 rounded-xl border border-line bg-surface" />
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="rounded-xl border border-line bg-surface px-3 py-2.5">
            <div className={`${pulse} h-3 w-20`} />
            <div className={`${pulse} mt-2 h-6 w-8`} />
          </div>
        ))}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[1.25fr_1fr]">
        <div className="grid gap-4">
          <CardSkeleton rows={5} />
          <CardSkeleton rows={3} />
        </div>
        <div className="grid gap-4">
          <CardSkeleton rows={2} />
          <CardSkeleton rows={3} />
          <CardSkeleton rows={3} />
        </div>
      </div>
    </div>
  );
}
