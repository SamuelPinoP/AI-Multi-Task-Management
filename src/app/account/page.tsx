import { AccountSessions } from "@/components/account-sessions";
import { AccountUsernameForm } from "@/components/account-username-form";
import { uiCardClass } from "@/components/ui";
import { countActiveSessions, requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SESSION_IDLE_DAYS } from "@/lib/session-lifetime";

/** Account settings: how you log in (#351) and where you're signed in (#354). Opened from the account menu and the command palette. */
export default async function AccountPage() {
  const user = await requirePageUser();
  const [{ username }, activeSessions] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { username: true } }),
    user.isGuest ? 1 : countActiveSessions(user.id),
  ]);

  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <header>
        <h1 className="text-title">Account</h1>
        <p className="mt-0.5 text-sm text-muted">How you log in to AI Multi, and where you&apos;re signed in.</p>
      </header>

      <section aria-labelledby="login-details" className={uiCardClass}>
        <h2 id="login-details" className="text-card">Log in</h2>
        {user.isGuest ? (
          <p className="mt-1 text-sm text-muted">
            This is a guest workspace. It lives in this browser&apos;s session, so it has no email, username or password.
            Create an account to log in from anywhere.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">Log in with your email or your username, and your password.</p>
            <dl className="mt-4 grid gap-1.5">
              <dt className="text-sm font-medium">Email</dt>
              <dd className="truncate text-sm text-ink">{user.email}</dd>
            </dl>
            <div className="mt-4">
              <AccountUsernameForm initialUsername={username} />
            </div>
          </>
        )}
      </section>

      {user.isGuest ? null : (
        <section aria-labelledby="signed-in-devices" className={uiCardClass}>
          <h2 id="signed-in-devices" className="text-card">Signed-in devices</h2>
          <p className="mt-1 text-sm text-muted">
            You stay signed in on each device until you log out there, or until it goes {SESSION_IDLE_DAYS} days without
            opening AI Multi. After a year, you log in again.
          </p>
          <AccountSessions otherDevices={Math.max(0, activeSessions - 1)} />
        </section>
      )}
    </div>
  );
}
