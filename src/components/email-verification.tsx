"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { authPageHref, confirmEmailHref } from "@/lib/auth-links";
import { cn } from "@/lib/cn";
import { EMAIL_MAX_LENGTH, formatCountdown } from "@/lib/email-confirmation-core";
import { useRefreshOnReturn } from "@/lib/use-page-activity";

type EmailResponse = { message?: string; error?: string; code?: string; retryAfterSeconds?: number };
type Notice = { tone: "success" | "error"; text: string };

const inputClass =
  "mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600";
const linkButtonClass = "font-medium text-ink underline underline-offset-4";
const disabledLook = "aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

/**
 * Seconds until another email may be sent. Starts from what the server said
 * when it made the page, so a reload doesn't reset the wait; `restart` takes
 * the wait from a later answer. The clock is read in timers, never while
 * rendering.
 */
function useResendCountdown(serverSeconds: number) {
  const [secondsLeft, setSecondsLeft] = useState(serverSeconds);
  const deadline = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const run = useCallback((seconds: number) => {
    window.clearInterval(timer.current);
    deadline.current = Date.now() + seconds * 1000;
    timer.current = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) window.clearInterval(timer.current);
    }, 250);
  }, []);

  useEffect(() => {
    run(serverSeconds);
    return () => window.clearInterval(timer.current);
  }, [run, serverSeconds]);

  const restart = useCallback(
    (seconds: number) => {
      setSecondsLeft(seconds);
      run(seconds);
    },
    [run],
  );

  return { secondsLeft, restart };
}

/**
 * The actions on "Check your email" (#350): send the link again once the
 * countdown allows it, or fix a mistyped address. The page checks again
 * whenever the reader comes back to it, so a link opened elsewhere moves it
 * on without polling.
 */
export function ConfirmEmailActions({
  next,
  hasLiveLink,
  secondsUntilResend,
}: {
  /** Where the account continues once its email is confirmed. */
  next: string;
  /** Whether a link that still works went out, so this is a "Resend". */
  hasLiveLink: boolean;
  secondsUntilResend: number;
}) {
  const router = useRouter();
  const { secondsLeft, restart } = useResendCountdown(secondsUntilResend);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [changing, setChanging] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const newEmailInput = useRef<HTMLInputElement>(null);
  const newEmailId = useId();

  useRefreshOnReturn(() => router.refresh());

  useEffect(() => {
    if (changing) newEmailInput.current?.focus();
  }, [changing]);

  async function send(method: "POST" | "PATCH", body: Record<string, string>) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/auth/verify-email", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, next }),
      });
      const result = (await response.json().catch(() => ({}))) as EmailResponse;
      if (response.status === 401) {
        // The session ended: logging in again comes back here.
        window.location.assign(authPageHref("login", { next }));
        return false;
      }
      if (result.code === "confirmed") {
        // Confirmed from another tab or device: on to the app.
        router.refresh();
        return false;
      }
      if (result.retryAfterSeconds) restart(result.retryAfterSeconds);
      if (!response.ok) {
        setNotice({ tone: "error", text: result.error || "We couldn't send the email just now. Try again in a moment." });
        return false;
      }
      setNotice({ tone: "success", text: result.message || "We sent you a new link." });
      // Show the page for the link just sent, without a note about an older one that failed.
      router.replace(confirmEmailHref({ next }), { scroll: false });
      return true;
    } catch {
      setNotice({ tone: "error", text: "We couldn't reach AI Multi. Check your connection and try again." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const waiting = secondsLeft > 0;

  function resend() {
    if (waiting || busy) return;
    void send("POST", {});
  }

  async function changeEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (await send("PATCH", { email: newEmail })) {
      setChanging(false);
      setNewEmail("");
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* aria-disabled rather than disabled, so the button keeps focus while it waits. */}
        <button
          type="button"
          onClick={resend}
          aria-disabled={waiting || busy}
          className={cn(hasLiveLink ? uiButtonClass : uiPrimaryButtonClass, disabledLook)}
        >
          {hasLiveLink ? "Resend email" : "Send link"}
        </button>
        {waiting ? (
          <span className="text-sm text-muted">
            You can resend in <span className="tabular-nums">{formatCountdown(secondsLeft)}</span>
          </span>
        ) : null}
      </div>

      <p role="status" className={notice?.tone === "success" ? "rounded-xl bg-success-soft px-3 py-2 text-sm text-success ring-1 ring-success/25" : "sr-only"}>
        {notice?.tone === "success" ? notice.text : busy ? "Sending…" : ""}
      </p>
      <p
        role="alert"
        className={
          notice?.tone === "error"
            ? "rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900"
            : "sr-only"
        }
      >
        {notice?.tone === "error" ? notice.text : ""}
      </p>

      {hasLiveLink ? (
        <p className="text-sm text-muted">Can&apos;t find it? Check your spam or junk folder. The link works for 24 hours.</p>
      ) : null}

      {changing ? (
        <form onSubmit={(event) => void changeEmail(event)} className="space-y-3 rounded-xl border border-line p-4">
          <div>
            <label htmlFor={newEmailId} className="text-sm font-medium">
              New email address
            </label>
            <input
              ref={newEmailInput}
              id={newEmailId}
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={EMAIL_MAX_LENGTH}
              required
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" aria-disabled={busy} className={cn(uiPrimaryButtonClass, disabledLook)}>
              Change address
            </button>
            <button type="button" onClick={() => setChanging(false)} className={uiButtonClass}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted">
          Wrong address?{" "}
          <button type="button" onClick={() => setChanging(true)} className={linkButtonClass}>
            Change it
          </button>
        </p>
      )}
    </div>
  );
}
