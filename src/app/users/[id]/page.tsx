import { Mail } from "lucide-react";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { BackLink, uiButtonClass, uiCardClass } from "@/components/ui";
import { UserBadges } from "@/components/user-badges";
import { requireAppAdminPage } from "@/lib/app-admin";
import { cn } from "@/lib/cn";
import { countryName } from "@/lib/sign-in-history-core";
import { getUserTimeZone } from "@/lib/user-time-server";
import { DETAIL_LIST_SIZE, getUserDetail } from "@/lib/users-admin";
import {
  activityLabel,
  activityTotals,
  fullDateTime,
  isNewAccount,
  relativeDay,
  signInLabel,
  signsInWith,
} from "@/lib/users-admin-core";

function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={uiCardClass}>
      <h2 id={id} className="text-card">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Facts({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
      {items.map(({ label, value }) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted">{label}</dt>
          <dd className="text-sm font-medium text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One account on the owner-only Users page: its dates, how it signs in, its sign-in history and the
 * kinds of things it did, never what it wrote. A 404 for anyone but the admins, and for ids that
 * aren't accounts.
 */
export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAppAdminPage();
  const { id } = await params;
  const now = new Date();
  const [user, timeZone] = await Promise.all([getUserDetail(id, now), getUserTimeZone()]);
  if (!user) notFound();

  const when = (at: Date | null) =>
    at ? (
      <time dateTime={at.toISOString()} title={fullDateTime(at, timeZone)}>
        {relativeDay(at, now, timeZone)}
      </time>
    ) : (
      <span className="text-muted">Never</span>
    );
  const totals = activityTotals(user.activityCounts);

  return (
    <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <div>
        <BackLink href="/users">Users</BackLink>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="truncate text-title">{user.name || user.email}</h1>
            <UserBadges user={user} isNew={isNewAccount(user.signedUpAt, now)} />
          </div>
          <p className="mt-0.5 truncate text-sm text-muted">
            {user.username ? `@${user.username} · ` : null}
            {user.email}
          </p>
        </div>
        <a href={`mailto:${user.email}`} className={cn(uiButtonClass, "gap-1.5 px-3 py-1.5")}>
          <Mail aria-hidden="true" className="h-4 w-4" />
          Email {user.name ? user.name.split(/\s+/)[0] : "them"}
        </a>
      </header>

      <Card id="user-account" title="Account">
        <Facts
          items={[
            { label: "Signed up", value: fullDateTime(user.signedUpAt, timeZone) },
            {
              label: "Email confirmed",
              value: user.confirmedAt ? fullDateTime(user.confirmedAt, timeZone) : <span className="text-warning">Not yet</span>,
            },
            { label: "Signs in with", value: signsInWith(user) },
            { label: "Last active", value: when(user.lastActiveAt) },
            { label: "Sign-ins", value: user.signIns.toLocaleString("en-US") },
            { label: "Last sign-in", value: when(user.lastSignInAt) },
            { label: "Signed in now", value: `${user.signedInNow.toLocaleString("en-US")} ${user.signedInNow === 1 ? "device" : "devices"}` },
            { label: "Active days", value: user.activeDays.toLocaleString("en-US") },
          ]}
        />
      </Card>

      <Card id="user-made" title="What they made">
        <Facts
          items={[
            { label: "Tasks", value: user.made.tasks.toLocaleString("en-US") },
            { label: "Notes", value: user.made.notes.toLocaleString("en-US") },
            { label: "Events", value: user.made.events.toLocaleString("en-US") },
            { label: "Projects", value: user.made.projects.toLocaleString("en-US") },
            { label: "Chat messages", value: user.made.messages.toLocaleString("en-US") },
            { label: "Projects shared with them", value: user.sharedProjects.toLocaleString("en-US") },
          ]}
        />
        {totals.length ? (
          <>
            <h3 className="mt-5 text-xs font-medium text-muted">From the activity log</h3>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {totals.map((total) => (
                <li key={total}>{total}</li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>

      <Card id="user-sign-ins" title="Sign-in history">
        {user.signInHistory.length ? (
          <>
            <ul className="mt-3 divide-y divide-line">
              {user.signInHistory.map((signIn) => (
                <li key={signIn.id} className="grid grid-cols-1 gap-x-4 gap-y-0.5 py-2.5 text-sm sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,1fr)]">
                  <time dateTime={signIn.at.toISOString()} className="tabular-nums">
                    {fullDateTime(signIn.at, timeZone)}
                  </time>
                  <span className="font-medium">{signInLabel(signIn.method, signIn.newAccount)}</span>
                  <span className="text-muted">
                    {[signIn.device ?? "Unknown device", signIn.country ? countryName(signIn.country) : null].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
            {user.signIns > user.signInHistory.length ? (
              <p className="mt-2 text-xs text-muted">The latest {DETAIL_LIST_SIZE} of {user.signIns.toLocaleString("en-US")}.</p>
            ) : null}
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">No sign-ins recorded yet. Each one is recorded from the next time they sign in.</p>
        )}
      </Card>

      <Card id="user-actions" title="Recent actions">
        {user.recentActions.length ? (
          <ul className="mt-3 divide-y divide-line">
            {user.recentActions.map((action) => (
              <li key={action.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 text-sm">
                <span>{activityLabel(action.action)}</span>
                <time dateTime={action.at.toISOString()} title={fullDateTime(action.at, timeZone)} className="text-xs text-muted tabular-nums">
                  {relativeDay(action.at, now, timeZone)}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted">Nothing in the activity log yet.</p>
        )}
      </Card>
    </div>
  );
}
