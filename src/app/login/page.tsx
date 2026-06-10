import Link from "next/link";
import { redirect } from "next/navigation";
import {
  createGuestSession,
  createSession,
  getCurrentUser,
  getSafeRedirectPath,
  isGuestLoginEnabled,
  isPublicSignupEnabled,
  normalizeAuthEmail,
  verifyPassword,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uiCardClass, uiPrimaryButtonClass } from "@/components/ui";

async function loginAction(formData: FormData) {
  "use server";

  const email = normalizeAuthEmail(String(formData.get("email") || ""));
  const password = String(formData.get("password") || "");
  const nextPath = getSafeRedirectPath(String(formData.get("next") || ""));

  if (!email || !password) {
    redirect(`/login?error=missing&next=${encodeURIComponent(nextPath)}`);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, isGuest: true },
  });

  if (!user || user.isGuest || !verifyPassword(password, user.passwordHash)) {
    redirect(`/login?error=invalid&next=${encodeURIComponent(nextPath)}`);
  }

  await createSession(user.id);
  redirect(nextPath);
}

async function guestAction(formData: FormData) {
  "use server";

  const currentUser = await getCurrentUser();
  const nextPath = getSafeRedirectPath(String(formData.get("next") || ""));

  if (!isGuestLoginEnabled()) {
    redirect(
      `/login?error=guest-disabled&next=${encodeURIComponent(nextPath)}`,
    );
  }

  if (!currentUser) {
    await createGuestSession();
  }

  redirect(nextPath);
}

function getErrorMessage(error: string | undefined) {
  if (error === "missing") return "Enter your email and password.";
  if (error === "created") return "Account created. Please sign in.";
  if (error === "logged-out") return "You have been logged out.";
  if (error === "invalid") return "Invalid email or password.";
  if (error === "guest-disabled")
    return "Guest access is disabled for this deployment.";
  return null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const currentUser = await getCurrentUser();
  if (currentUser) redirect("/");

  const { error, next } = await searchParams;
  const nextPath = getSafeRedirectPath(next);
  const errorMessage = getErrorMessage(error);
  const guestLoginEnabled = isGuestLoginEnabled();
  const signupEnabled = isPublicSignupEnabled();
  const isSuccessMessage = error === "created" || error === "logged-out";

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 items-center px-4 py-12">
      <section className="grid w-full gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className={`${uiCardClass} p-6`}>
          <div className="space-y-2">
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Welcome back
            </p>
            <h1 className="text-2xl font-semibold">Log in to your workspace</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Use your AI-Multi Task-Management account to continue to notes,
              tasks, projects, chat, and planning views.
            </p>
          </div>

          {errorMessage ? (
            <p
              className={`mt-4 rounded-xl px-3 py-2 text-sm ${
                isSuccessMessage
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900"
                  : "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900"
              }`}
            >
              {errorMessage}
            </p>
          ) : null}

          <form action={loginAction} className="mt-6 space-y-4">
            <input type="hidden" name="next" value={nextPath} />
            <div>
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
              />
            </div>
            <div>
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
              />
            </div>
            <button
              type="submit"
              className={`${uiPrimaryButtonClass} w-full justify-center`}
            >
              Log in
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-zinc-600 dark:text-zinc-400">
            {signupEnabled ? (
              <>
                New here?{" "}
                <Link
                  href="/signup"
                  className="font-medium text-zinc-950 underline underline-offset-4 dark:text-zinc-50"
                >
                  Create an account
                </Link>
              </>
            ) : (
              "Public signup is restricted on this deployment. Use a provided account to log in."
            )}
          </p>
        </div>

        {guestLoginEnabled ? (
          <aside className="rounded-3xl border border-zinc-200 bg-gradient-to-br from-zinc-950 to-zinc-800 p-6 text-white shadow-sm dark:border-zinc-800 dark:from-zinc-900 dark:to-zinc-950">
            <div className="flex h-full flex-col justify-between gap-8">
              <div className="space-y-3">
                <span className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium ring-1 ring-white/15">
                  No signup needed
                </span>
                <h2 className="text-3xl font-semibold tracking-tight">
                  Start planning in a guest workspace.
                </h2>
                <p className="text-sm leading-6 text-zinc-300">
                  Continue as a guest to create notes, tasks, projects, calendar
                  events, discussions, and assignments right away. Your data is
                  saved in the database and scoped to your guest session cookie.
                </p>
              </div>

              <form action={guestAction} className="space-y-3">
                <input type="hidden" name="next" value={nextPath} />
                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:-translate-y-0.5 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  Continue as Guest
                </button>
                <p className="text-xs text-zinc-400">
                  Guest access persists until the session expires or you log
                  out. You can still create a full account anytime.
                </p>
              </form>
            </div>
          </aside>
        ) : (
          <aside className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-900 shadow-sm dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
            <div className="space-y-3">
              <span className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-100 dark:ring-amber-800">
                Restricted access
              </span>
              <h2 className="text-3xl font-semibold tracking-tight">
                Guest access is disabled.
              </h2>
              <p className="text-sm leading-6">
                This deployment is configured for known accounts only. If you
                are reviewing the demo, use the credentials provided by the
                workspace owner.
              </p>
            </div>
          </aside>
        )}
      </section>
    </main>
  );
}
