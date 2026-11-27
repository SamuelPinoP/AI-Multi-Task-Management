"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { GoogleSignIn } from "@/components/google-sign-in-button";
import { GuestLoginForm, guestAuthLinkClass } from "@/components/guest/guest-login-form";
import { AgreementNotice } from "@/components/legal";
import { uiPrimaryButtonClass } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { authPageHref } from "@/lib/auth-links";
import { cn } from "@/lib/cn";
import { guestSignupCopy, type GuestSignupReason } from "@/lib/guest-limits-core";
import { MINIMUM_AGE } from "@/lib/legal";
import { pageAfterGuestLogin } from "@/lib/login-core";

/** Which of the guest's pop-ups shows: sign up (#458) or log in (#543). Their links switch between them in place. */
export type GuestAuthView = "signup" | "login";

const BENEFITS = [
  "As many tasks, events and notes as you like",
  "The AI assistant",
  "Invite teammates and chat",
  "Your work on all your devices",
];

/**
 * The first thing to use, in reading order: what Radix focuses when a dialog opens, except that a
 * link counts too, so the sign-up pop-up without Google starts on Sign up with email, not Log in.
 */
function focusFirstControl(container: HTMLElement | null) {
  container?.querySelector<HTMLElement>("a[href], button, input:not([type='hidden'])")?.focus();
}

/**
 * The guest's sign-up pop-up (#458, design 3B): why it opened, what an account adds, and the ways
 * in, all in one place, as ChatGPT, Figma and Canva do it. Google finishes in one step; email goes
 * to the sign-up page, whose form is too long for a pop-up. It opens from Sign up free, the AI,
 * and anything a guest makes past a limit.
 */
function GuestSignupView({ reason, next, googleSignIn, onLogIn }: { reason: GuestSignupReason; next: string; googleSignIn: boolean; onLogIn: () => void }) {
  const { title, description } = guestSignupCopy(reason);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <ul className="grid gap-2 text-sm">
        {BENEFITS.map((benefit) => (
          <li key={benefit} className="flex items-center gap-2.5">
            <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-accent" />
            {benefit}
          </li>
        ))}
      </ul>
      <div className="grid gap-5">
        {googleSignIn ? <GoogleSignIn next={next} /> : null}
        <Link href={authPageHref("signup", { next })} className={cn(uiPrimaryButtonClass, "w-full font-semibold max-lg:min-h-11")}>
          Sign up with email
        </Link>
      </div>
      <p className="text-center text-sm text-muted">
        Have an account?{" "}
        <button type="button" onClick={onLogIn} className={guestAuthLinkClass}>
          Log in
        </button>
      </p>
      <AgreementNotice className="text-center">You must be {MINIMUM_AGE} or older. By continuing,</AgreementNotice>
    </>
  );
}

/**
 * The guest's way into an account, over the page they're on: the sign-up pop-up, or the log-in
 * pop-up (#543), which the guest profile's Log in opens. One dialog holds both, so switching
 * between them keeps it open and moves focus to what the other one starts with.
 */
export function GuestAuthDialog({
  open,
  view,
  reason,
  googleSignIn,
  next: nextPath,
  onViewChange,
  onOpenChange,
}: {
  open: boolean;
  view: GuestAuthView;
  /** Why the sign-up pop-up opened, which its words say. */
  reason: GuestSignupReason;
  /** Whether Sign in with Google is set up on this server. */
  googleSignIn: boolean;
  /** Where to come back to, query and all, such as the consent page for an AI app (#477). */
  next?: string;
  onViewChange: (view: GuestAuthView) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const pathname = usePathname();
  // Afterwards they come back here, or to the AI when the AI is what they wanted. Logging in leaves
  // the guest's work behind, so a page of something they made lands on its list instead.
  const chosen = nextPath ?? (reason === "ai" ? "/ai" : null);
  const content = useRef<HTMLDivElement>(null);
  const switched = useRef(false);
  // What had focus before it opened. Its buttons open it with an event, not as its trigger, so Radix
  // doesn't know where to go back to; without this, closing it left keyboard users at the top.
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!switched.current) return;
    switched.current = false;
    focusFirstControl(content.current);
  }, [view]);

  const switchTo = (to: GuestAuthView) => {
    switched.current = true;
    onViewChange(to);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={content}
        className="max-w-md"
        onOpenAutoFocus={(event) => {
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          event.preventDefault();
          focusFirstControl(content.current);
        }}
        onCloseAutoFocus={(event) => {
          const back = opener.current;
          opener.current = null;
          // Gone with a menu or card that closed when it opened: Radix's own choice stands.
          if (!back?.isConnected) return;
          event.preventDefault();
          back.focus();
        }}
      >
        {view === "login" ? (
          <GuestLoginForm next={chosen ?? pageAfterGuestLogin(pathname)} googleSignIn={googleSignIn} onSignUp={() => switchTo("signup")} />
        ) : (
          <GuestSignupView reason={reason} next={chosen ?? pathname} googleSignIn={googleSignIn} onLogIn={() => switchTo("login")} />
        )}
      </DialogContent>
    </Dialog>
  );
}
