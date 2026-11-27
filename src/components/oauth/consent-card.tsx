"use client";

import { Check, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { GuestAuthDialog, type GuestAuthView } from "@/components/guest/guest-auth-dialog";
import { uiButtonClass, uiCardClass, uiPrimaryButtonClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { OAUTH_PATHS } from "@/lib/mcp/oauth";

export type ConsentApp = {
  name: string;
  /** Where Allow sends the person back to, such as "claude.ai" (MCP requires showing it). */
  address: string;
  /** The app runs on this computer, so anything on it could have started this. */
  loopback: boolean;
  tile: string;
};

/** The page's frame (design 3C): the bare layout's header is the app shell's; the card sits high and centred. */
function ConsentFrame({ children }: { children: ReactNode }) {
  return <main className="grid flex-1 justify-items-center px-4 pb-10 pt-6 sm:pt-24">{children}</main>;
}

const cardClass = cn(uiCardClass, "grid w-full max-w-[33.125rem] gap-4 px-5 py-[1.375rem] sm:gap-5 sm:p-6");

function AppHeading({ app }: { app: ConsentApp }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-line bg-sunken text-[0.9375rem] font-bold tracking-[-0.01em]">
        {app.tile}
      </span>
      <div className="min-w-0">
        <p className="text-[0.9375rem] font-semibold wrap-anywhere">{app.name}</p>
        <p className="font-mono text-xs text-muted wrap-anywhere">{app.address}</p>
      </div>
    </div>
  );
}

const titleClass = "text-[1.3125rem] font-semibold leading-7 tracking-[-0.01em] wrap-anywhere sm:text-2xl sm:leading-8";

/** The consent link's own parameters, sent back with Allow or Cancel so every check runs again. */
function HiddenFields({ fields }: { fields: Array<[string, string]> }) {
  return (
    <>
      {/* A parameter can repeat, so each field's key is its place. */}
      {fields.map(([name, value], index) => (
        <input key={`${index}-${name}`} type="hidden" name={name} value={value} />
      ))}
    </>
  );
}

/** Allow or Cancel posts once: a second click while the app opens would make a second code. */
function useSubmitOnce() {
  const sent = useRef(false);
  return (event: FormEvent) => {
    if (sent.current) event.preventDefault();
    sent.current = true;
  };
}

/**
 * The consent page (#477, design 3C): which app is asking and where it sends you back, what it
 * may do as choices in plain words, then Allow or Cancel. "See" is always on, since nothing works
 * without it; "Create, change and delete" shows only when the app asks to write, and starts on.
 */
export function ConsentCard({
  app,
  signedInAs,
  wantsWrite,
  fields,
}: {
  app: ConsentApp;
  signedInAs: string;
  wantsWrite: boolean;
  fields: Array<[string, string]>;
}) {
  const [write, setWrite] = useState(true);
  const submitOnce = useSubmitOnce();
  const writes = wantsWrite && write;
  const summary = writes ? `${app.name} will read and change your work.` : `${app.name} will only read your work.`;

  return (
    <ConsentFrame>
      <form method="post" action={OAUTH_PATHS.decide} onSubmit={submitOnce} className={cardClass} aria-labelledby="consent-title">
        <HiddenFields fields={fields} />
        <AppHeading app={app} />
        <div>
          <h1 id="consent-title" className={titleClass}>
            {app.name} wants to use your AI Multi account
          </h1>
          <p className="mt-1.5 text-sm text-muted sm:text-base">
            Signed in as {signedInAs}.{wantsWrite ? ` Choose what ${app.name} can do.` : null}
          </p>
          {app.loopback ? (
            <p className="mt-1.5 text-sm text-muted">It runs on your computer. Allow it only if you started connecting it just now.</p>
          ) : null}
        </div>

        <div className="grid rounded-xl border border-line">
          <div className={cn("flex gap-3 p-3.5 sm:px-4", wantsWrite && "border-b border-line")}>
            <span aria-hidden="true" className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[0.25rem] bg-muted text-surface">
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block">See your tasks, projects, calendar, notes and goals</span>
              <span className="text-xs text-muted">Needed to connect</span>
            </span>
          </div>
          {wantsWrite ? (
            <label className="flex cursor-pointer gap-3 p-3.5 sm:px-4">
              <span className="relative mt-0.5 grid h-4 w-4 shrink-0 place-items-center">
                <input
                  type="checkbox"
                  name="write"
                  checked={write}
                  onChange={(event) => setWrite(event.target.checked)}
                  className="peer h-4 w-4 cursor-pointer appearance-none rounded-[0.25rem] border-[0.09375rem] border-muted bg-surface checked:border-accent checked:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                />
                <Check aria-hidden="true" className="pointer-events-none absolute h-3 w-3 text-accent-ink opacity-0 peer-checked:opacity-100" strokeWidth={3} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block">Create, change and delete tasks, events and notes</span>
                <span className="text-xs text-muted">Leave this off and {app.name} can only read.</span>
              </span>
            </label>
          ) : null}
        </div>

        <p className="flex gap-2.5 text-sm sm:text-base">
          <X aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-danger sm:mt-1" />
          It can&apos;t see your password.
        </p>

        <div className="grid gap-4 sm:flex sm:items-center sm:gap-2 sm:border-t sm:border-line sm:pt-4">
          <p aria-live="polite" className="text-sm text-muted sm:flex-1">
            {summary}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <button type="submit" name="decision" value="cancel" className={cn(uiButtonClass, "max-sm:min-h-11")}>
              Cancel
            </button>
            <button type="submit" name="decision" value="allow" className={cn(uiPrimaryButtonClass, "max-sm:min-h-11 sm:min-w-24")}>
              Allow
            </button>
          </div>
        </div>
      </form>
    </ConsentFrame>
  );
}

/**
 * The consent page for a guest: apps can only connect to an account, so it offers the sign-up
 * pop-up, which comes back here, or Cancel. Its Log in switches to the log-in pop-up (#543), which
 * comes back here too.
 */
export function GuestConsentCard({
  app,
  fields,
  next,
  googleSignIn,
}: {
  app: ConsentApp;
  fields: Array<[string, string]>;
  next: string;
  googleSignIn: boolean;
}) {
  const [auth, setAuth] = useState<{ open: boolean; view: GuestAuthView }>({ open: false, view: "signup" });
  const submitOnce = useSubmitOnce();
  return (
    <ConsentFrame>
      <form method="post" action={OAUTH_PATHS.decide} onSubmit={submitOnce} className={cardClass} aria-labelledby="consent-title">
        <HiddenFields fields={fields} />
        <AppHeading app={app} />
        <div>
          <h1 id="consent-title" className={titleClass}>
            {app.name} wants to use your AI Multi account
          </h1>
          <p className="mt-1.5 text-sm text-muted sm:text-base">Connecting AI apps needs a free account. Everything you made here comes with you.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end sm:border-t sm:border-line sm:pt-4">
          <button type="submit" name="decision" value="cancel" className={cn(uiButtonClass, "max-sm:min-h-11")}>
            Cancel
          </button>
          <button type="button" onClick={() => setAuth({ open: true, view: "signup" })} className={cn(uiPrimaryButtonClass, "max-sm:min-h-11")}>
            Sign up free
          </button>
        </div>
      </form>
      <GuestAuthDialog
        open={auth.open}
        view={auth.view}
        reason="ai-apps"
        next={next}
        googleSignIn={googleSignIn}
        onViewChange={(view) => setAuth((current) => ({ ...current, view }))}
        onOpenChange={(open) => setAuth((current) => ({ ...current, open }))}
      />
    </ConsentFrame>
  );
}

/** Why the consent page can't go on: nothing is sent back to an app that can't be trusted with it. */
export function ConsentProblem({ message }: { message: string }) {
  return (
    <ConsentFrame>
      <section className={cardClass} aria-labelledby="consent-problem">
        <h1 id="consent-problem" className={titleClass}>
          Can&apos;t connect this app
        </h1>
        <p className="text-muted">{message}</p>
        <div>
          <Link href="/" className={uiButtonClass}>
            Go to AI Multi
          </Link>
        </div>
      </section>
    </ConsentFrame>
  );
}
