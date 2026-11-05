"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { signUp, type SignupField, type SignupState } from "@/app/signup/actions";
import { uiPrimaryButtonClass } from "@/components/ui";
import { authPageHref } from "@/lib/auth-links";
import { USERNAME_INPUT_PATTERN, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_RULES } from "@/lib/username";

// The red border of a field with an error stays while it has focus, which it gets after a failed attempt.
const inputClass =
  "mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600 aria-[invalid=true]:border-red-500! dark:aria-[invalid=true]:border-red-400!";
const hintClass = "mt-1 text-xs text-zinc-600 dark:text-zinc-400";
const ERROR_ID = "signup-error";

const fieldIds: Record<SignupField, string> = { name: "name", username: "username", email: "email", password: "password" };

/**
 * Sign up. Marked up for password managers (#351): the email is the login they
 * save (`autocomplete="username"`), and both passwords are new ones, so
 * browsers offer a strong password and fill this login in on the login page.
 */
export function SignupForm({ invitedEmail, next }: { invitedEmail: string; next: string }) {
  const [state, formAction, pending] = useActionState<SignupState, FormData>(signUp, {
    error: null,
    values: { name: "", username: "", email: invitedEmail },
  });

  // Move to the field the error is about, so it can be fixed right away.
  useEffect(() => {
    if (state.field) document.getElementById(fieldIds[state.field])?.focus();
  }, [state]);

  /** Props that tie a field to the error when the error is about it. */
  const errorFor = (field: SignupField, hintId?: string) => {
    const invalid = state.field === field;
    const describedBy = [hintId, invalid ? ERROR_ID : null].filter(Boolean).join(" ");
    return { "aria-invalid": invalid || undefined, "aria-describedby": describedBy || undefined };
  };

  return (
    <form action={formAction} className="mt-6 space-y-4">
      {state.error ? (
        // A field's error is read out when the field takes focus; any other is announced.
        <p
          id={ERROR_ID}
          role={state.field ? undefined : "alert"}
          className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900"
        >
          {state.error}
          {state.emailTaken ? (
            <>
              {" "}
              <Link href={authPageHref("login", { email: state.values.email, next })} className="font-medium underline underline-offset-4">
                Log in instead
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="name" className="text-sm font-medium">Name</label>
        <input id="name" name="name" autoComplete="name" defaultValue={state.values.name} required className={inputClass} {...errorFor("name")} />
      </div>
      <div>
        <label htmlFor="username" className="text-sm font-medium">Username</label>
        {/* Not the login password managers save (that's the email below), so they leave it alone. */}
        <input
          id="username"
          name="username"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          minLength={USERNAME_MIN_LENGTH}
          maxLength={USERNAME_MAX_LENGTH}
          pattern={USERNAME_INPUT_PATTERN}
          title={USERNAME_RULES}
          defaultValue={state.values.username}
          required
          className={inputClass}
          {...errorFor("username", "username-hint")}
        />
        <p id="username-hint" className={hintClass}>
          {USERNAME_RULES} You can log in with it instead of your email.
        </p>
      </div>
      <div>
        <label htmlFor="email" className="text-sm font-medium">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          defaultValue={state.values.email}
          required
          className={inputClass}
          {...errorFor("email")}
        />
      </div>
      <div>
        <label htmlFor="password" className="text-sm font-medium">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          className={inputClass}
          {...errorFor("password", "password-hint")}
        />
        <p id="password-hint" className={hintClass}>At least 8 characters.</p>
      </div>
      <div>
        <label htmlFor="confirmPassword" className="text-sm font-medium">Confirm password</label>
        <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required className={inputClass} />
      </div>
      <button type="submit" disabled={pending} className={`${uiPrimaryButtonClass} w-full justify-center`}>
        Create account
      </button>
    </form>
  );
}
