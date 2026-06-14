import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, hashPassword, hashSecureToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uiCardClass, uiPrimaryButtonClass } from "@/components/ui";

async function resetPasswordAction(formData: FormData) {
  "use server";

  const token = String(formData.get("token") || "");
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");
  const tokenParam = encodeURIComponent(token);

  if (!token || !password || !confirmPassword) redirect(`/reset-password?token=${tokenParam}&error=missing`);
  if (password !== confirmPassword) redirect(`/reset-password?token=${tokenParam}&error=mismatch`);
  if (password.length < 8) redirect(`/reset-password?token=${tokenParam}&error=password`);

  const tokenHash = hashSecureToken(token);
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= new Date()) {
    redirect("/reset-password?error=invalid");
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: resetToken.userId }, data: { passwordHash: hashPassword(password) } }),
    prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } }),
    prisma.passwordResetToken.deleteMany({ where: { userId: resetToken.userId, id: { not: resetToken.id } } }),
    prisma.session.deleteMany({ where: { userId: resetToken.userId } }),
  ]);

  redirect("/login?error=reset");
}

function getErrorMessage(error: string | undefined) {
  if (error === "missing") return "New password and confirmation are required.";
  if (error === "mismatch") return "New password and confirm password must match.";
  if (error === "password") return "Password must be at least 8 characters.";
  if (error === "invalid") return "This reset link is invalid or expired. Request a new reset link.";
  return null;
}

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const currentUser = await getCurrentUser();
  if (currentUser) redirect("/");
  const { token = "", error } = await searchParams;
  const errorMessage = getErrorMessage(error || (!token ? "invalid" : undefined));

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 items-center px-4 py-12">
      <section className={`${uiCardClass} w-full p-6`}>
        <h1 className="text-2xl font-semibold">Choose a new password</h1>
        {errorMessage ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">{errorMessage}</p> : null}
        {token ? (
          <form action={resetPasswordAction} className="mt-6 space-y-4">
            <input type="hidden" name="token" value={token} />
            <div>
              <label htmlFor="password" className="text-sm font-medium">New password</label>
              <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600" />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="text-sm font-medium">Confirm new password</label>
              <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600" />
            </div>
            <button type="submit" className={`${uiPrimaryButtonClass} w-full justify-center`}>Reset password</button>
          </form>
        ) : null}
        <p className="mt-5 text-center text-sm text-zinc-600 dark:text-zinc-400"><Link href="/forgot-password" className="font-medium text-zinc-950 underline underline-offset-4 dark:text-zinc-50">Request a new link</Link></p>
      </section>
    </main>
  );
}
