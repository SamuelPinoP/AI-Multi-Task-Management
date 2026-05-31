import Link from "next/link";
import { redirect } from "next/navigation";
import { createSession, getCurrentUser, normalizeAuthEmail, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uiCardClass, uiPrimaryButtonClass } from "@/components/ui";

async function loginAction(formData: FormData) {
  "use server";

  const email = normalizeAuthEmail(String(formData.get("email") || ""));
  const password = String(formData.get("password") || "");

  if (!email || !password) {
    redirect("/login?error=missing");
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  });

  if (!user || !verifyPassword(password, user.passwordHash)) {
    redirect("/login?error=invalid");
  }

  await createSession(user.id);
  redirect("/");
}

function getErrorMessage(error: string | undefined) {
  if (error === "missing") return "Enter your email and password.";
  if (error === "created") return "Account created. Please sign in.";
  if (error === "logged-out") return "You have been logged out.";
  if (error === "invalid") return "Invalid email or password.";
  return null;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const currentUser = await getCurrentUser();
  if (currentUser) redirect("/");

  const { error } = await searchParams;
  const errorMessage = getErrorMessage(error);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 items-center px-4 py-12">
      <section className={`${uiCardClass} w-full p-6`}>
        <div className="space-y-2">
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Welcome back</p>
          <h1 className="text-2xl font-semibold">Log in to your workspace</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Use your AI-Multi Task-Management account to continue.</p>
        </div>

        {errorMessage ? (
          <p className={`mt-4 rounded-xl px-3 py-2 text-sm ${error === "created" || error === "logged-out" ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900" : "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900"}`}>
            {errorMessage}
          </p>
        ) : null}

        <form action={loginAction} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="text-sm font-medium">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600" />
          </div>
          <div>
            <label htmlFor="password" className="text-sm font-medium">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600" />
          </div>
          <button type="submit" className={`${uiPrimaryButtonClass} w-full justify-center`}>Log in</button>
        </form>

        <p className="mt-5 text-center text-sm text-zinc-600 dark:text-zinc-400">
          New here? <Link href="/signup" className="font-medium text-zinc-950 underline underline-offset-4 dark:text-zinc-50">Create an account</Link>
        </p>
      </section>
    </main>
  );
}
