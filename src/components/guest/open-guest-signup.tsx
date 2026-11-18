"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { GuestSignupReason } from "@/lib/guest-limits-core";
import { openGuestSignup } from "@/lib/workspace-events";

/**
 * Opens the guest's sign-up pop-up once, on a page a server action sent the guest back to past a
 * limit (#458), then drops the reason from the address so a reload doesn't open it again.
 */
export function OpenGuestSignup({ reason }: { reason: GuestSignupReason }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    // After this commit: a page's effects run before the app shell's, which listens for the event.
    const timer = window.setTimeout(() => {
      openGuestSignup(reason);
      router.replace(pathname, { scroll: false });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname, reason, router]);

  return null;
}
