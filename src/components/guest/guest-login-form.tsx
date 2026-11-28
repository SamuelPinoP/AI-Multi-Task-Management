"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { GoogleSignIn } from "@/components/google-sign-in-button";
import { AgreementNotice } from "@/components/legal";
import { uiPrimaryButtonClass } from "@/components/ui";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LOGIN_IDENTIFIER_MAX_LENGTH } from "@/lib/auth-constants";
import { cn } from "@/lib/cn";
import { loginFailureMessage, type LoginFailure } from "@/lib/login-core";
import { getSafeRedirectPath } from "@/lib/safe-redirect";

/** The links in the guest's pop-ups ("Log in", "Sign up free", "Forgot password?"). */
export const guestAuthLinkClass = "rounded-sm font-medium text-accent hover:underline";

const FAILURES = new Set<string>(["missing", "invalid", "unconfirmed", "rate-limited"] satisfies LoginFailure[]);

/** What went wrong: an answer from /api/auth/login, no answer at all, or one it doesn't explain. */
type Failure = { error: LoginFailure; retryAfterSeconds?: number } | { error: "unreachable" } | { error: "failed" };

function failureMessage(failure: Failure) {
  if (failure.error === "unreachable") return "We couldn't reach AI Multi. Check your connection and try again.";
  if (failure.error === "failed") return "We couldn't log you in just now. Try again in a moment.";
  return loginFailureMessage(failure.error, failure.retryAfterSeconds);
}

// The red border of a field with an error stays while it has focus, which it gets after a failed attempt.
const fieldClass =
  "mt-1.5 block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25 aria-[invalid=true]:border-danger! max-lg:min-h-11";

/**
 * The guest's log-in pop-up (#543): the /login page's form over the workspace, so logging in keeps
 * their place. It stays a real form, the same fields posted to the same address, marked up the way
 * password managers look for a login (#351); it sends them with fetch, so a wrong password or too
 * many attempts shows its message here and keeps what was typed. A login that works goes on to the
 * page they were on with a full page load, as the account from the first frame, and that's when
 * browsers offer to save the password.
 */
export function GuestLoginForm({ next, googleSignIn, onSignUp }: { next: string; googleSignIn: boolean; onSignUp: () => void }) {
  const form = useRef<HTMLFormElement>(null);
  const loginField = useRef<HTMLInputElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);
  // The field to move to once the error shows, so it's read out with the field.
  const focusAfter = useRef<HTMLInputElement | null>(null);
  const id = useId();
  const errorId = `${id}-error`;

  useEffect(() => {
    focusAfter.current?.focus();
    focusAfter.current = null;
  }, [failure]);

  async function logIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const body = new FormData(event.currentTarget);
    setPending(true);
    setFailure(null);

    let answer: { next?: unknown; error?: unknown; retryAfterSeconds?: unknown } | null = null;
    let worked = false;
    try {
      const response = await fetch("/api/auth/login", { method: "POST", body, headers: { Accept: "application/json" } });
      worked = response.ok;
      answer = await response.json().catch(() => ({}));
    } catch {
      // No answer: offline, or the server is down.
    }
    if (worked && typeof answer?.next === "string") {
      // Still busy while the next page loads, so a second press sends nothing.
      window.location.assign(getSafeRedirectPath(answer.next));
      return;
    }

    setPending(false);
    const error = typeof answer?.error === "string" && FAILURES.has(answer.error) ? (answer.error as LoginFailure) : null;
    if (!error) {
      setFailure({ error: answer ? "failed" : "unreachable" });
      return;
    }
    // What was typed stays. A wrong password goes, ready to be typed again, as on the /login page.
    if (error === "invalid" && passwordField.current) {
      passwordField.current.value = "";
      focusAfter.current = passwordField.current;
    }
    if (error === "missing") focusAfter.current = loginField.current?.value.trim() ? passwordField.current : loginField.current;
    setFailure({ error, retryAfterSeconds: typeof answer?.retryAfterSeconds === "number" ? answer.retryAfterSeconds : undefined });
  }

  /**
   * The right password, but the email isn't confirmed (#350): the same form, posted the plain way,
   * goes on to "Check your email", which sends a new link and continues to this page once it's
   * confirmed. The guest workspace is left then, as with any login.
   */
  function confirmEmail() {
    setPending(true);
    form.current?.submit();
  }

  // An error about what was typed is read out with the field it moves to; any other is announced.
  const aboutFields = failure?.error === "invalid" || failure?.error === "missing";
  const fieldProps = aboutFields ? { "aria-invalid": true, "aria-describedby": errorId } : {};

  return (
    <>
      <DialogHeader>
        <DialogTitle>Log in to AI Multi</DialogTitle>
      </DialogHeader>
      <div className="grid gap-5">
        {googleSignIn ? <GoogleSignIn next={next} /> : null}
        <form ref={form} action="/api/auth/login" method="post" onSubmit={(event) => void logIn(event)} className="grid gap-4">
          <input type="hidden" name="next" value={next} />
          {failure ? (
            <p
              id={errorId}
              role={aboutFields ? undefined : "alert"}
              className={cn(
                "rounded-lg px-3 py-2 text-sm",
                failure.error === "unconfirmed" ? "bg-warning-soft text-ink" : "bg-danger-soft text-danger",
              )}
            >
              {failureMessage(failure)}
              {failure.error === "unconfirmed" ? (
                <>
                  {" "}
                  <button type="button" onClick={confirmEmail} className="rounded-sm font-semibold underline underline-offset-4">
                    Get a new link
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
          <div>
            <label htmlFor={`${id}-login`} className="text-sm font-medium">
              Email or username
            </label>
            {/* "username" names the account whether an email or a username is typed, so a saved login fills both fields. */}
            <input
              ref={loginField}
              id={`${id}-login`}
              name="login"
              type="text"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={LOGIN_IDENTIFIER_MAX_LENGTH}
              required
              className={fieldClass}
              {...fieldProps}
            />
          </div>
          <div>
            <label htmlFor={`${id}-password`} className="text-sm font-medium">
              Password
            </label>
            <input
              ref={passwordField}
              id={`${id}-password`}
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={fieldClass}
              {...fieldProps}
            />
            <p className="mt-2 text-right text-sm">
              <Link href="/forgot-password" className={guestAuthLinkClass}>
                Forgot password?
              </Link>
            </p>
          </div>
          {/* aria-disabled rather than disabled, so the button keeps focus while the login goes through. */}
          <button
            type="submit"
            aria-disabled={pending || undefined}
            className={cn(uiPrimaryButtonClass, "w-full font-semibold max-lg:min-h-11 aria-disabled:cursor-wait aria-disabled:opacity-70")}
          >
            Log in
          </button>
        </form>
      </div>
      <p className="text-center text-sm text-muted">
        New here?{" "}
        <button type="button" onClick={onSignUp} className={guestAuthLinkClass}>
          Sign up free
        </button>
      </p>
      {/* Continuing with Google can create an account from here too (#356). */}
      <AgreementNotice className="text-center">By continuing,</AgreementNotice>
    </>
  );
}
