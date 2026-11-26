"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GoogleSignIn } from "@/components/google-sign-in-button";
import { AgreementNotice } from "@/components/legal";
import { uiPrimaryButtonClass } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { authPageHref } from "@/lib/auth-links";
import { cn } from "@/lib/cn";
import { guestSignupCopy, type GuestSignupReason } from "@/lib/guest-limits-core";
import { MINIMUM_AGE } from "@/lib/legal";

const BENEFITS = [
  "As many tasks, events and notes as you like",
  "The AI assistant",
  "Invite teammates and chat",
  "Your work on all your devices",
];

/**
 * The guest's sign-up pop-up (#458, design 3B): why it opened, what an account adds, and the ways
 * in, all in one place, as ChatGPT, Figma and Canva do it. Google finishes in one step; email goes
 * to the sign-up page, whose form is too long for a pop-up. It opens from Sign up free, the AI,
 * and anything a guest makes past a limit.
 */
export function GuestSignupDialog({
  open,
  reason,
  googleSignIn,
  next: nextPath,
  onOpenChange,
}: {
  open: boolean;
  reason: GuestSignupReason;
  /** Whether Sign in with Google is set up on this server. */
  googleSignIn: boolean;
  /** Where to come back to, query and all, such as the consent page for an AI app (#477). */
  next?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const pathname = usePathname();
  // Afterwards they come back here, or to the AI when the AI is what they wanted.
  const next = nextPath ?? (reason === "ai" ? "/ai" : pathname);
  const { title, description } = guestSignupCopy(reason);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
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
          <Link href={authPageHref("login", { next })} className="font-medium text-accent hover:underline">
            Log in
          </Link>
        </p>
        <AgreementNotice className="text-center">You must be {MINIMUM_AGE} or older. By continuing,</AgreementNotice>
      </DialogContent>
    </Dialog>
  );
}
