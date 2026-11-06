import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, getSafeRedirectPath, isPublicSignupEnabled, normalizeAuthEmail } from "@/lib/auth";
import { authPageHref } from "@/lib/auth-links";
import { isGoogleSignInEnabled } from "@/lib/google-auth";
import { GoogleSignIn } from "@/components/google-sign-in-button";
import { AgreementNotice } from "@/components/legal";
import { MINIMUM_AGE } from "@/lib/legal";
import { SignedInAsOtherAccount } from "@/components/signed-in-as-other-account";
import { SignupForm } from "@/components/signup-form";
import { uiCardClass } from "@/components/ui";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ email?: string; next?: string }> }) {
  const { email, next } = await searchParams;
  const invitedEmail = email ? normalizeAuthEmail(email) : "";
  const nextPath = getSafeRedirectPath(next);

  const currentUser = await getCurrentUser();
  if (currentUser) {
    if (!invitedEmail || invitedEmail === normalizeAuthEmail(currentUser.email)) redirect(nextPath);
    return (
      <SignedInAsOtherAccount
        currentUser={currentUser}
        email={invitedEmail}
        switchHref={authPageHref("signup", { email: invitedEmail, next: nextPath })}
        stayHref={nextPath}
      />
    );
  }

  const loginHref = authPageHref("login", { email: invitedEmail, next: nextPath });
  const signupEnabled = isPublicSignupEnabled();
  const googleEnabled = isGoogleSignInEnabled();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 items-center px-4 py-12">
      <section className={`${uiCardClass} w-full p-6`}>
        <div className="space-y-2">
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Create your account</p>
          <h1 className="text-2xl font-semibold">Start your workspace</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {signupEnabled && googleEnabled ? "Continue with Google, or sign up" : "Sign up"} with your name, a username, your email and a password.
          </p>
        </div>

        {signupEnabled ? (
          <>
            {/* Signing up with Google needs no form and no confirmation email (#356). */}
            {googleEnabled ? <GoogleSignIn next={nextPath} className="mt-6" /> : null}
            <SignupForm invitedEmail={invitedEmail} next={nextPath} />
          </>
        ) : (
          <p className="mt-6 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900">
            Public signup is disabled for this deployment. Sign in with a
            provided account.
          </p>
        )}

        <p className="mt-5 text-center text-sm text-zinc-600 dark:text-zinc-400">
          Already have an account? <Link href={loginHref} className="font-medium text-zinc-950 underline underline-offset-4 dark:text-zinc-50">Log in</Link>
        </p>
        {signupEnabled ? (
          <AgreementNotice className="mt-4 text-center">
            You must be {MINIMUM_AGE} or older. By creating an account{googleEnabled ? " or continuing with Google" : ""},
          </AgreementNotice>
        ) : null}
      </section>
    </main>
  );
}
