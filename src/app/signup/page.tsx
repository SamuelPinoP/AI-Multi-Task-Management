import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, hashPassword, isPublicSignupEnabled, normalizeAuthEmail } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uiCardClass, uiPrimaryButtonClass } from "@/components/ui";

async function signupAction(formData: FormData) {
  "use server";

  if (!isPublicSignupEnabled()) redirect("/signup?error=disabled");

  const name = String(formData.get("name") || "").trim();
  const email = normalizeAuthEmail(String(formData.get("email") || ""));
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (!name || !email || !password || !confirmPassword) redirect("/signup?error=missing");
  if (password !== confirmPassword) redirect(`/signup?error=mismatch&email=${encodeURIComponent(email)}`);
  if (password.length < 8) redirect(`/signup?error=password&email=${encodeURIComponent(email)}`);

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) redirect("/signup?error=exists");

  await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: hashPassword(password),
    },
  });

  redirect("/login?error=created");
}

function getErrorMessage(error: string | undefined) {
  if (error === "missing") return "Name, email, and password are required.";
  if (error === "password") return "Password must be at least 8 characters.";
  if (error === "mismatch") return "Password and confirm password must match.";
  if (error === "exists") return "An account with that email already exists.";
  if (error === "disabled") return "Public signup is disabled for this deployment.";
  return null;
}

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string; email?: string }> }) {
  const currentUser = await getCurrentUser();
  if (currentUser) redirect("/");

  const { error, email } = await searchParams;
  const invitedEmail = email ? normalizeAuthEmail(email) : "";
  const errorMessage = getErrorMessage(error);
  const signupEnabled = isPublicSignupEnabled();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 items-center px-4 py-12">
      <section className={`${uiCardClass} w-full p-6`}>
        <div className="space-y-2">
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Create your account</p>
          <h1 className="text-2xl font-semibold">Start your workspace</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Sign up with a name, email, and password.</p>
        </div>

        {errorMessage ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">{errorMessage}</p> : null}

        {signupEnabled ? (
          <form action={signupAction} className="mt-6 space-y-4">
            <div>
              <label htmlFor="name" className="text-sm font-medium">Name</label>
              <input id="name" name="name" autoComplete="name" required className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600" />
            </div>
            <div>
              <label htmlFor="email" className="text-sm font-medium">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" defaultValue={invitedEmail} required className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600" />
            </div>
            <div>
              <label htmlFor="password" className="text-sm font-medium">Password</label>
              <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600" />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="text-sm font-medium">Confirm password</label>
              <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600" />
            </div>
            <button type="submit" className={`${uiPrimaryButtonClass} w-full justify-center`}>Create account</button>
          </form>
        ) : (
          <p className="mt-6 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900">
            Public signup is disabled for this deployment. Sign in with a
            provided account.
          </p>
        )}

        <p className="mt-5 text-center text-sm text-zinc-600 dark:text-zinc-400">
          Already have an account? <Link href="/login" className="font-medium text-zinc-950 underline underline-offset-4 dark:text-zinc-50">Log in</Link>
        </p>
      </section>
    </main>
  );
}
