import { MailCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ConfirmEmailActions } from "@/components/email-verification";
import { uiCardClass, uiPrimaryButtonClass } from "@/components/ui";
import { getSafeRedirectPath, getSessionUser, mustConfirmEmail } from "@/lib/auth";
import { authPageHref } from "@/lib/auth-links";
import { secondsUntilResend } from "@/lib/email-confirmation-core";
import { newestConfirmationLink } from "@/lib/email-verification";

function Card({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 items-center px-4 py-12">
      <section className={`${uiCardClass} w-full p-6`}>{children}</section>
    </main>
  );
}

/**
 * "Check your email" (#350). A new account, or one that logged in before
 * confirming, waits here until the link in its confirmation email is opened;
 * then it continues to `next`. The link lands here too in a browser that
 * isn't signed in to that account, to say how it went.
 */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ status?: string; next?: string }> }) {
  const [{ status, next: nextParam }, user] = await Promise.all([searchParams, getSessionUser()]);
  const next = getSafeRedirectPath(nextParam);

  if (user && mustConfirmEmail(user)) {
    const link = await newestConfirmationLink(user.id);
    const now = new Date();
    const hasLiveLink = Boolean(link && link.expiresAt > now);
    return (
      <Card>
        <span className="grid h-11 w-11 place-items-center rounded-full bg-accent-soft text-accent">
          <MailCheck aria-hidden="true" className="h-5 w-5" />
        </span>
        <h1 className="mt-4 text-2xl font-semibold">{hasLiveLink ? "Check your email" : "Confirm your email"}</h1>
        <p className="mt-2 text-sm text-muted">
          {hasLiveLink ? (
            <>
              We sent a link to <strong className="break-words text-ink">{user.email}</strong>. Open it to confirm your address and
              start using AI Multi.
            </>
          ) : (
            <>
              To start using AI Multi, confirm that <strong className="break-words text-ink">{user.email}</strong> is your address.
              We&apos;ll email you a link.
            </>
          )}
        </p>
        {status === "invalid" ? (
          <p className="mt-4 rounded-xl bg-warning-soft px-3 py-2 text-sm text-ink">
            That link has expired or a newer one replaced it. Use the newest email, or send a new link.
          </p>
        ) : null}
        <ConfirmEmailActions next={next} hasLiveLink={hasLiveLink} secondsUntilResend={secondsUntilResend(link?.createdAt, now)} />
        <form action="/api/auth/logout" method="post" className="mt-6 border-t border-line pt-4 text-sm text-muted">
          Want to use another account?{" "}
          <button type="submit" className="font-medium text-ink underline underline-offset-4">
            Log out
          </button>
        </form>
      </Card>
    );
  }

  // Already confirmed, or a guest, with no link to report on: carry on.
  if (user && !status) redirect(next);

  // A link that no longer works, opened while signed in to a confirmed account, is an old one for it.
  const confirmed = status === "confirmed" || Boolean(user?.emailVerifiedAt);
  const action = user ? { href: next, label: "Continue" } : { href: authPageHref("login", { next }), label: "Log in" };
  const [title, text] = confirmed
    ? ["Email confirmed", user ? "Your account is ready." : "Your account is ready. Log in to start using AI Multi, or go back to where you signed up."]
    : status === "invalid"
      ? ["This link didn't work", `It may have expired, or a newer one replaced it.${user ? "" : " Log in to get a new link."}`]
      : ["Confirm your email", "Open the link in the email we sent you. To get a new one, log in."];

  return (
    <Card>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted">{text}</p>
      <Link href={action.href} className={`${uiPrimaryButtonClass} mt-6 w-full justify-center`}>
        {action.label}
      </Link>
    </Card>
  );
}
