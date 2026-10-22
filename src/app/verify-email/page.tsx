import Link from "next/link";
import { ResendVerificationButton } from "@/components/email-verification";
import { uiCardClass, uiPrimaryButtonClass } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";

/** Where the confirmation link lands (#130), signed in or not. */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const [{ status }, user] = await Promise.all([searchParams, getCurrentUser()]);
  const confirmed = status === "confirmed" || Boolean(user?.emailVerifiedAt);
  const next = user ? { href: "/projects", label: "Go to your projects" } : { href: "/login", label: "Log in" };

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 items-center px-4 py-12">
      <section className={`${uiCardClass} w-full p-6`}>
        {confirmed ? (
          <>
            <h1 className="text-2xl font-semibold">Email confirmed</h1>
            <p className="mt-2 text-sm text-muted">Thanks. You can now see and accept project invitations sent to your email.</p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">{status === "invalid" ? "This link didn't work" : "Confirm your email"}</h1>
            <p className="mt-2 text-sm text-muted">
              {status === "invalid" ? "It may have expired or already been used. " : "Open the link we emailed you to confirm your address. "}
              {user && !user.isGuest
                ? "You can ask for a new one below."
                : "Log in, then use “Email me a confirmation link” at the top of the page."}
            </p>
            {user && !user.isGuest ? (
              <p className="mt-4 text-sm">
                <ResendVerificationButton className="text-accent" />
              </p>
            ) : null}
          </>
        )}
        <Link href={next.href} className={`${uiPrimaryButtonClass} mt-6 w-full justify-center`}>
          {next.label}
        </Link>
      </section>
    </main>
  );
}
