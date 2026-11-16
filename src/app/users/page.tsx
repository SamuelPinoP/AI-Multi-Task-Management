import Link from "next/link";
import { uiCardClass } from "@/components/ui";
import { UserBadges } from "@/components/user-badges";
import { requireAppAdminPage } from "@/lib/app-admin";
import { formatInstant } from "@/lib/user-time";
import { getUserTimeZone } from "@/lib/user-time-server";
import { getUserList, type UserListEntry } from "@/lib/users-admin";
import { fullDateTime, isNewAccount, madeSummary, relativeDay, usersSummary } from "@/lib/users-admin-core";

function Made({ user }: { user: UserListEntry }) {
  const parts = madeSummary(user.made);
  return parts.length ? <>{parts.join(", ")}</> : <span className="text-muted">Nothing yet</span>;
}

function When({ at, now, timeZone }: { at: Date | null; now: Date; timeZone: string | null }) {
  if (!at) return <span className="text-muted">Never</span>;
  return (
    <time dateTime={at.toISOString()} title={fullDateTime(at, timeZone)}>
      {relativeDay(at, now, timeZone)}
    </time>
  );
}

/**
 * The owner-only Users page: everyone with an account, newest first, with when they signed up,
 * signed in and were last active, and how much they made. Dates and counts only, never what people
 * wrote. Only the accounts in ADMIN_EMAILS can open it; everyone else gets a 404 (#286).
 */
export default async function UsersPage() {
  await requireAppAdminPage();
  const [{ users, signInsSince }, timeZone] = await Promise.all([getUserList(), getUserTimeZone()]);
  const now = new Date();
  const summary = usersSummary(users, now);
  const figures = [
    { label: "Accounts", value: summary.accounts },
    { label: "Confirmed", value: summary.confirmed },
    { label: "Active this week", value: summary.activeThisWeek },
    { label: "New this week", value: summary.newThisWeek },
  ];

  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <header>
        <h1 className="text-title">Users</h1>
        <p className="mt-0.5 text-sm text-muted">
          Everyone with an account, newest first. Dates and counts only, never what people write. Only the accounts in
          ADMIN_EMAILS can see this page.
        </p>
      </header>

      <section aria-labelledby="users-summary" className={uiCardClass}>
        <h2 id="users-summary" className="sr-only">
          Summary
        </h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {figures.map(({ label, value }) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="text-xl font-semibold tabular-nums text-ink">{value.toLocaleString("en-US")}</dd>
            </div>
          ))}
        </dl>
      </section>

      {users.length === 0 ? (
        <p className={`${uiCardClass} text-sm text-muted`}>No accounts yet.</p>
      ) : (
        <section aria-labelledby="users-list" className={`${uiCardClass} p-0`}>
          <h2 id="users-list" className="sr-only">
            Accounts
          </h2>

          {/* Phones: one card per person. */}
          <ul className="divide-y divide-line md:hidden">
            {users.map((user) => (
              <li key={user.id} className="px-4 py-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <Link href={`/users/${user.id}`} className="truncate font-semibold text-ink hover:underline">
                    {user.name || user.email}
                  </Link>
                  <UserBadges user={user} isNew={isNewAccount(user.signedUpAt, now)} />
                </div>
                <p className="truncate text-xs text-muted">
                  {user.username ? `@${user.username} · ` : null}
                  {user.email}
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div className="min-w-0">
                    <dt className="text-muted">Signed up</dt>
                    <dd>
                      <When at={user.signedUpAt} now={now} timeZone={timeZone} />
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted">Last active</dt>
                    <dd>
                      <When at={user.lastActiveAt} now={now} timeZone={timeZone} />
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted">Sign-ins</dt>
                    <dd className="tabular-nums">{user.signIns.toLocaleString("en-US")}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted">Made</dt>
                    <dd>
                      <Made user={user} />
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>

          {/* Computers: a table. */}
          <div className="hidden md:block">
            <table className="w-full table-fixed text-left text-sm">
              <caption className="sr-only">Accounts, newest first</caption>
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th scope="col" className="w-[34%] px-4 py-3 font-medium">
                    Person
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Signed up
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Last active
                  </th>
                  <th scope="col" className="w-24 px-4 py-3 text-right font-medium">
                    Sign-ins
                  </th>
                  <th scope="col" className="w-[24%] px-4 py-3 font-medium">
                    Made
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users.map((user) => (
                  <tr key={user.id} className="align-top hover:bg-surface-hover">
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <Link href={`/users/${user.id}`} className="truncate font-semibold text-ink hover:underline">
                          {user.name || user.email}
                        </Link>
                        <UserBadges user={user} isNew={isNewAccount(user.signedUpAt, now)} />
                      </div>
                      <p className="truncate text-xs text-muted">
                        {user.username ? `@${user.username} · ` : null}
                        {user.email}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <When at={user.signedUpAt} now={now} timeZone={timeZone} />
                    </td>
                    <td className="px-4 py-3">
                      <When at={user.lastActiveAt} now={now} timeZone={timeZone} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{user.signIns.toLocaleString("en-US")}</td>
                    <td className="px-4 py-3">
                      <Made user={user} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="text-xs text-muted">
        {signInsSince
          ? `Sign-ins are counted from ${formatInstant(signInsSince, timeZone, { month: "short", day: "numeric", year: "numeric" })}, the oldest one kept, and each is kept for a year.`
          : "No sign-ins are recorded yet: they're counted from the next one, and each is kept for a year."}{" "}
        Last active is accurate to the hour. For accounts that haven&apos;t been back since it was added, it comes from their
        sessions and the last thing they did.
      </p>
    </div>
  );
}
