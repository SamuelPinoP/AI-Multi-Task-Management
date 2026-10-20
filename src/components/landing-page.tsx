import Link from "next/link";
import { uiPrimaryButtonClass } from "@/components/ui";

const landingFeatures = [
  {
    title: "Notes",
    description:
      "Capture research notes, meeting takeaways, and project context, then connect them to projects when helpful.",
  },
  {
    title: "Tasks",
    description:
      "Track priorities, due dates, recurrence, assignments, and status from a list or a visual board.",
  },
  {
    title: "Projects",
    description:
      "Organize team workspaces with members, workload summaries, quick actions, calendars, and shared task context.",
  },
  {
    title: "Team collaboration",
    description:
      "Invite registered collaborators, show owner/shared access clearly, and keep member notes and permissions understandable.",
  },
  {
    title: "Project chat + attachments",
    description:
      "Discuss decisions and blockers in project chat, pin key messages, and attach files through local, Vercel Blob, or private AWS S3 storage.",
  },
  {
    title: "Planner and Today",
    description:
      "Use focused Today, Planner, Roadmap, and Calendar views to understand what needs attention next.",
  },
];

const demoFeatures = [
  "Database-backed auth/session flow",
  "Real project invitations and collaboration labels",
  "Project chat with file attachments",
  "Task board, Today, Planner, and Roadmap views",
];

export function LandingPage({
  signupEnabled,
  guestLoginEnabled,
}: {
  signupEnabled: boolean;
  guestLoginEnabled: boolean;
}) {
  const accessNote = getLandingAccessNote(signupEnabled, guestLoginEnabled);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.18),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.14),transparent_32%)] px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-12">
        <section className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="space-y-7">
            <div className="inline-flex rounded-full border border-zinc-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300">
              AI Multi
            </div>
            <div className="space-y-4">
              <h1 className="max-w-4xl text-4xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-6xl">
                A polished workspace for notes, tasks, projects, and team
                execution.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-300">
                Plan class projects, capstones, and team work in one place:
                capture notes, manage tasks, coordinate projects, chat with
                collaborators, attach files, and focus each day with Today and
                Planner views.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/login"
                className={`${uiPrimaryButtonClass} justify-center px-5 py-3`}
              >
                Log in
              </Link>
              {signupEnabled ? (
                <Link
                  href="/signup"
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white/90 px-5 py-3 text-sm font-semibold text-zinc-900 shadow-sm transition hover:-translate-y-0.5 hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-50 dark:hover:bg-zinc-900"
                >
                  Sign up
                </Link>
              ) : (
                <span className="inline-flex items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm font-medium text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
                  Signup is restricted on this deployment
                </span>
              )}
              {guestLoginEnabled ? (
                <form action="/api/auth/guest" method="post">
                  <button
                    type="submit"
                    className="inline-flex w-full items-center justify-center rounded-xl border border-zinc-300 bg-white/80 px-5 py-3 text-sm font-semibold text-zinc-900 shadow-sm transition hover:-translate-y-0.5 hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-50 dark:hover:bg-zinc-900 sm:w-auto"
                  >
                    Continue as guest
                  </button>
                </form>
              ) : (
                <span className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white/70 px-5 py-3 text-sm font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
                  Guest access is disabled
                </span>
              )}
            </div>
            {accessNote ? (
              <p className="max-w-2xl rounded-2xl border border-zinc-200 bg-white/75 px-4 py-3 text-sm text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
                {accessNote}
              </p>
            ) : null}
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white/85 p-5 shadow-2xl shadow-zinc-300/40 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/75 dark:shadow-none">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-950/70">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Demo dashboard
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold">
                    What reviewers can evaluate quickly
                  </h2>
                </div>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                  Demo-ready
                </span>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {demoFeatures.map((feature) => (
                  <div
                    key={feature}
                    className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm font-medium text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                  >
                    {feature}
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-2xl bg-zinc-900 p-4 text-sm leading-6 text-zinc-200 dark:bg-zinc-100 dark:text-zinc-800">
                Built with Next.js, React, TypeScript, Prisma, and PostgreSQL,
                with deployment-ready docs and Vercel-friendly storage support.
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {landingFeatures.map((feature) => (
            <article
              key={feature.title}
              className="rounded-2xl border border-zinc-200 bg-white/85 p-6 shadow-sm backdrop-blur transition hover:-translate-y-1 hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-900/70"
            >
              <h2 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
                {feature.title}
              </h2>
              <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                {feature.description}
              </p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}

function getLandingAccessNote(signupEnabled: boolean, guestLoginEnabled: boolean) {
  if (signupEnabled && !guestLoginEnabled) {
    return "Guest access is disabled. Create an account or sign in to review the app.";
  }

  if (!signupEnabled && guestLoginEnabled) {
    return "Public signup is disabled. Continue as a guest, or sign in with a provided account.";
  }

  if (!signupEnabled && !guestLoginEnabled) {
    return "This deployment is restricted to known accounts. Sign in with credentials provided by the workspace owner.";
  }

  return null;
}
