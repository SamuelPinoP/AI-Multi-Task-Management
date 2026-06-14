import Link from "next/link";
import { redirect } from "next/navigation";
import { createSecureToken, getCurrentUser, hashSecureToken, normalizeAuthEmail } from "@/lib/auth";
import { sendPasswordResetEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { uiCardClass, uiPrimaryButtonClass } from "@/components/ui";

const GENERIC_MESSAGE = "If an account exists, a reset link was sent.";
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

async function forgotPasswordAction(formData: FormData) {
  "use server";

  const email = normalizeAuthEmail(String(formData.get("email") || ""));
  if (email) {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, isGuest: true } });
    if (user && !user.isGuest) {
      const token = createSecureToken();
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashSecureToken(token),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });
      const baseUrl = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
      await sendPasswordResetEmail({ to: user.email, resetUrl: `${baseUrl}/reset-password?token=${encodeURIComponent(token)}` });
    }
  }

  redirect("/forgot-password?sent=1");
}

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const currentUser = await getCurrentUser();
  if (currentUser) redirect("/");
  const { sent } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 items-center px-4 py-12">
      <section className={`${uiCardClass} w-full p-6`}>
        <h1 className="text-2xl font-semibold">Reset your password</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Enter your account email and we will send a reset link if the account exists.</p>
        {sent ? <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900">{GENERIC_MESSAGE}</p> : null}
        <form action={forgotPasswordAction} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="text-sm font-medium">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600" />
          </div>
          <button type="submit" className={`${uiPrimaryButtonClass} w-full justify-center`}>Send reset link</button>
        </form>
        <p className="mt-5 text-center text-sm text-zinc-600 dark:text-zinc-400"><Link href="/login" className="font-medium text-zinc-950 underline underline-offset-4 dark:text-zinc-50">Back to login</Link></p>
      </section>
    </main>
  );
}
