"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LogoMark } from "@/components/brand/logo-mark";
import { LegalLinks } from "@/components/legal";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { authPageHref } from "@/lib/auth-links";
import { cn } from "@/lib/cn";

/**
 * What a new visitor sees on `/` (#460). With guest workspaces on, the browser asks for one with
 * sample content, then Home opens in it. With them off, the page stays and offers sign-up and log-in,
 * so `/` never becomes a log-in wall: Google's sign-in branding needs a public home page that links the
 * privacy policy (#358). Scripts that never run here (the uptime check, link previews) see this page,
 * with a way to log in and the legal links, either way.
 */
export function GuestStart({ guests, signup }: { guests: boolean; signup: boolean }) {
  const [state, setState] = useState<"starting" | "stuck" | "ways-in">(guests ? "starting" : "ways-in");

  useEffect(() => {
    if (!guests) return;
    const controller = new AbortController();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    fetch("/api/auth/guest/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeZone }),
      signal: controller.signal,
    })
      .then(async (response) => {
        // Started, or signed in meanwhile in another tab: Home, from the server.
        if (response.ok || response.status === 409) return window.location.replace("/");
        const body = (await response.json().catch(() => null)) as { error?: string; retryAfterSeconds?: number } | null;
        if (body?.error === "rate-limited") return window.location.replace(authPageHref("login", { error: "rate-limited", retry: body.retryAfterSeconds }));
        // Switched off since the page was made: the same page without a guest workspace.
        if (body?.error === "guest-disabled") return setState("ways-in");
        setState("stuck");
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("stuck");
      });
    return () => controller.abort();
  }, [guests]);

  const waysIn = state === "ways-in";

  return (
    <main className="grid flex-1 place-items-center px-4 py-16">
      <div className="grid w-full max-w-sm justify-items-center gap-4 text-center">
        <LogoMark className="h-12 w-12" />
        <div className="grid gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">AI Multi</h1>
          <p className="text-sm text-muted">
            Tasks, notes, a calendar and team chat in one workspace.{waysIn ? null : " Try it without an account."}
          </p>
        </div>
        {waysIn ? (
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
            {signup ? (
              <Link href={authPageHref("signup")} className={cn(uiPrimaryButtonClass, "shine px-5 font-semibold max-sm:min-h-11")}>
                Sign up free
              </Link>
            ) : null}
            <Link href="/login" className={cn(signup ? uiButtonClass : uiPrimaryButtonClass, "px-5 font-semibold max-sm:min-h-11")}>
              Log in
            </Link>
          </div>
        ) : state === "stuck" ? (
          <div className="grid justify-items-center gap-3">
            <p className="text-sm">The guest workspace didn&apos;t start.</p>
            <button type="button" onClick={() => window.location.reload()} className={cn(uiButtonClass, "font-semibold")}>
              Try again
            </button>
          </div>
        ) : (
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent motion-reduce:animate-none" />
            Setting up your workspace…
          </p>
        )}
        {waysIn ? null : (
          <>
            <noscript>
              <p className="text-sm">Turn on JavaScript to try AI Multi without an account.</p>
            </noscript>
            <p className="text-sm text-muted">
              Have an account?{" "}
              <Link href="/login" className="font-medium text-accent hover:underline">
                Log in
              </Link>
            </p>
          </>
        )}
        <LegalLinks className="justify-center" />
      </div>
    </main>
  );
}
