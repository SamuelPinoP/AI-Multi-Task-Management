"use client";

import { MailWarning } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

/** Asks for a new confirmation link (#130) and says how it went. */
export function ResendVerificationButton({ className }: { className?: string }) {
  const [state, setState] = useState<{ sending: boolean; message: string; failed: boolean }>({
    sending: false,
    message: "",
    failed: false,
  });

  async function resend() {
    setState({ sending: true, message: "", failed: false });
    try {
      const response = await fetch("/api/auth/verify-email", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (response.status === 409) {
        // Confirmed in another tab or on another device: show the app without the reminder.
        window.location.reload();
        return;
      }
      setState({
        sending: false,
        message: response.ok ? body.message || "We sent you a link." : body.error || "Could not send the link. Try again later.",
        failed: !response.ok,
      });
    } catch {
      setState({ sending: false, message: "Could not send the link. Check your connection and try again.", failed: true });
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        onClick={() => void resend()}
        disabled={state.sending}
        className={cn("font-semibold underline underline-offset-4 disabled:opacity-60", className)}
      >
        {state.sending ? "Sending..." : "Email me a confirmation link"}
      </button>
      <span role="status" className={state.failed ? "font-semibold" : undefined}>
        {state.message}
      </span>
    </span>
  );
}

/** Shown across the app until the user confirms their email. */
export function EmailVerificationBanner({ email }: { email: string }) {
  return (
    <div className="flex shrink-0 items-start gap-2 border-b border-line bg-warning-soft px-4 py-2 text-sm text-ink sm:px-6">
      <MailWarning aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <p className="min-w-0">
        <span>
          Confirm your email address, <strong className="break-all">{email}</strong>, to see and accept project invitations.{" "}
        </span>
        <ResendVerificationButton />
      </p>
    </div>
  );
}
