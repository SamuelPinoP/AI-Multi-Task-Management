import { AccountUsernameForm } from "@/components/account-username-form";
import { uiCardClass } from "@/components/ui";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** Account settings: for now, how you log in (#351). Opened from the account menu and the command palette. */
export default async function AccountPage() {
  const user = await requirePageUser();
  const { username } = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { username: true } });

  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <header>
        <h1 className="text-title">Account</h1>
        <p className="mt-0.5 text-sm text-muted">How you log in to AI Multi.</p>
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
    </div>
  );
}
