"use client";

import { Copy } from "lucide-react";
import { Fragment, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { toast } from "@/components/ui/toaster";
import { useTodayKey, useUserTimeZone } from "@/components/user-time-zone";
import { cn } from "@/lib/cn";
import {
  appTile,
  connectApps,
  connectedAppDay,
  EXAMPLE_REQUESTS,
  knownApp,
  knownAppId,
  type ConnectApp,
  type ConnectedAppView,
  type ConnectStep,
} from "@/lib/mcp/connect";
import { openGuestSignup } from "@/lib/workspace-events";

/** The rows' small buttons (design 1A): 2rem tall. */
const smallButton = "h-8 gap-1.5 px-3 py-0 text-[0.8125rem]";
const rowClass = "flex min-h-15 items-center gap-3 py-2.5 pl-4 pr-3 sm:min-h-14 sm:gap-3.5 sm:px-6 sm:py-[0.5625rem]";
const tileClass = "grid h-9 w-9 shrink-0 place-items-center rounded-[0.5625rem] border border-line bg-sunken text-[0.75rem] font-bold tracking-[-0.01em]";
const groupBarClass = "flex h-10 items-center gap-2.5 border-b border-line bg-sunken px-4 sm:pl-6";

async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error("Couldn't copy. Select the text and copy it instead.");
  }
}

/** A command or address in monospace, with Copy. `what` finishes the button's name: "Copy the command". */
function CodeBox({
  text,
  what,
  copied,
  wrap = false,
  onCopy,
}: {
  text: string;
  what: string;
  copied: string;
  /** Commands wrap on phones; the server's address stays on one line, cut short. */
  wrap?: boolean;
  /** Replaces copying, for guests. */
  onCopy?: () => void;
}) {
  return (
    // A wrapped command's first line stays level with Copy: both are centred 1.1875rem from the top.
    <div className={cn("flex min-h-[2.375rem] gap-2 rounded-lg border border-line bg-sunken py-1 pl-3 pr-1", wrap ? "items-start" : "items-center")}>
      <code title={text} className={cn("min-w-0 flex-1 font-mono text-[0.78125rem] leading-[1.125rem]", wrap ? "py-1.5 wrap-anywhere" : "truncate")}>
        {text}
      </code>
      <button
        type="button"
        onClick={() => (onCopy ? onCopy() : void copyText(text, copied))}
        className={cn(uiButtonClass, "h-7.5 shrink-0 gap-1.5 rounded-[0.4375rem] px-2.5 py-0 text-[0.8125rem]")}
      >
        <Copy aria-hidden="true" className="h-3.5 w-3.5" />
        {/* Phones show only the icon beside a command, so it has room to wrap. */}
        <span className={wrap ? "max-sm:sr-only" : undefined}>Copy</span>
        <span className="sr-only"> {what}</span>
      </button>
    </div>
  );
}

function Step({ step, number, serverUrl }: { step: ConnectStep; number: number; serverUrl: string }) {
  const address = step.code === serverUrl;
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-2.5">
      <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full bg-sunken text-[0.75rem] font-semibold text-muted">
        {number}
      </span>
      <div className="grid min-w-0 gap-2 pt-0.5">
        <p className="text-sm">{step.text}</p>
        {step.code ? (
          <div className="max-w-[57.5rem]">
            <CodeBox
              text={step.code}
              what={address ? "the server address" : "the command"}
              copied={address ? "Server address copied" : "Command copied"}
              wrap
            />
          </div>
        ) : null}
        {step.install ? (
          <div>
            <a href={step.install.href} className={cn(uiPrimaryButtonClass, smallButton)}>
              {step.install.label}
            </a>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** One app's row (1A); its button opens the steps under it (2A). */
function AppRow({ app, open, onToggle, serverUrl }: { app: ConnectApp; open: boolean; onToggle: () => void; serverUrl: string }) {
  const stepsId = `connect-${app.id}`;
  // Every row's button names its app for screen readers, unless its words already do ("Add to Cursor").
  const named = (words: string) => (words.includes(app.name) ? null : <span className="sr-only"> {app.name}</span>);
  return (
    <li className="border-b border-line bg-surface">
      <div className={rowClass}>
        <span aria-hidden="true" className={tileClass}>
          {app.tile}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{app.name}</p>
          <p className="truncate text-[0.8125rem] leading-[1.1875rem] text-muted">{app.description}</p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? stepsId : undefined}
          onClick={onToggle}
          className={cn(uiButtonClass, smallButton, "w-[5.375rem] shrink-0 sm:w-[8.25rem]")}
        >
          {open ? (
            <>
              Close<span className="sr-only"> the {app.name} steps</span>
            </>
          ) : (
            <>
              {/* Phones say Connect on every row (1A's phone board); computers name the one-click installs. */}
              <span className="sm:hidden">
                Connect{named("Connect")}
              </span>
              <span className="max-sm:hidden">
                {app.action}
                {named(app.action)}
              </span>
            </>
          )}
        </button>
      </div>
      {open ? (
        <div id={stepsId} className="grid gap-3.5 px-4 pb-[1.125rem] pt-0.5 sm:pb-[1.375rem] sm:pl-[4.625rem] sm:pr-6 sm:pt-1">
          <ol aria-label={`Connect ${app.name}`} className="grid gap-3.5">
            {app.steps.map((step, index) => (
              <Step key={step.text} step={step} number={index + 1} serverUrl={serverUrl} />
            ))}
          </ol>
          <p className="pl-[2.125rem] text-[0.8125rem] leading-[1.1875rem] text-muted">
            Then try asking{" "}
            {EXAMPLE_REQUESTS.map((request, index) => (
              <Fragment key={request}>
                {index === 0 ? null : index === EXAMPLE_REQUESTS.length - 1 ? " or " : ", "}
                <span className="text-ink">“{request}”</span>
              </Fragment>
            ))}
          </p>
        </div>
      ) : null}
    </li>
  );
}

/** A connected app's name in the list: the app's own name when it's one the list knows, else the name it gave. */
const connectedName = (app: ConnectedAppView) => knownApp(app)?.name ?? app.name;

/** One connected app (design 4C): when it connected, when it was last used, and Disconnect. */
function ConnectedAppRow({ app, onDisconnect }: { app: ConnectedAppView; onDisconnect: () => void }) {
  const timeZone = useUserTimeZone();
  const today = useTodayKey();
  const known = knownApp(app);
  const name = connectedName(app);
  const since = connectedAppDay(app.connectedAt, timeZone, today);
  const lastUsed = app.lastUsedAt ? connectedAppDay(app.lastUsedAt, timeZone, today) : "Not yet";
  return (
    <li className="border-b border-line bg-surface">
      <div className={rowClass}>
        <span aria-hidden="true" className={tileClass}>
          {known?.tile ?? appTile(name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="truncate text-[0.8125rem] leading-[1.1875rem] text-muted max-sm:hidden">{known?.description ?? app.address}</p>
          <p className="text-xs text-muted sm:hidden">
            Connected {since} · Last used {lastUsed}
          </p>
        </div>
        <div className="w-[9.375rem] shrink-0 max-sm:hidden">
          <p className="text-xs text-muted">Connected</p>
          <p className="text-sm">{since}</p>
        </div>
        <div className="w-[9.375rem] shrink-0 max-sm:hidden">
          <p className="text-xs text-muted">Last used</p>
          <p className="text-sm">{lastUsed}</p>
        </div>
        <button type="button" onClick={onDisconnect} className={cn(uiButtonClass, smallButton, "shrink-0 px-2.5 text-danger sm:w-[8.25rem]")}>
          Disconnect<span className="sr-only"> {name}</span>
        </button>
      </div>
    </li>
  );
}

/**
 * The Integrations page (#480): the MCP server's address, the apps already connected with
 * Disconnect (design 4C, #477), then every other AI app with its steps (design 1A, with 2A's steps
 * in the row). Every app signs in with OAuth (#477), which guests can't grant, so their Copy and
 * Connect open the sign-up pop-up instead.
 */
export function IntegrationsView({
  serverUrl,
  guest,
  connected: connectedApps,
}: {
  serverUrl: string;
  guest: boolean;
  connected: ConnectedAppView[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState<string[]>([]);
  const [asking, setAsking] = useState<ConnectedAppView | null>(null);
  const [busy, setBusy] = useState(false);
  const connected = connectedApps.filter((app) => !disconnected.includes(app.id));
  // A connected app leaves the list below; "Other AI apps" always stays.
  const connectedIds = new Set(connected.map(knownAppId));
  const apps = connectApps(serverUrl).filter((app) => !connectedIds.has(app.id));
  const askGuestToSignUp = guest ? () => openGuestSignup("ai-apps") : undefined;

  async function disconnect(app: ConnectedAppView) {
    setBusy(true);
    try {
      const response = await fetch(`/api/connected-apps/${encodeURIComponent(app.id)}`, { method: "DELETE" });
      // 404: it was disconnected already, say in another tab.
      if (!response.ok && response.status !== 404) throw new Error(`Disconnect failed: ${response.status}`);
      setDisconnected((ids) => [...ids, app.id]);
      setAsking(null);
      toast.success(`${connectedName(app)} is disconnected`);
    } catch {
      toast.error("Couldn't disconnect the app. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center gap-3 px-4 pb-4 pt-5 sm:border-b sm:border-line sm:px-6 sm:py-3">
        <h1 className="text-title">Integrations</h1>
      </header>

      <section
        aria-labelledby="server-address"
        className="grid gap-2 border-b border-line bg-surface px-4 pb-3.5 pt-3 max-sm:border-t sm:flex sm:items-center sm:gap-6 sm:px-6 sm:py-3.5"
      >
        <div className="min-w-0">
          <h2 id="server-address" className="text-sm font-semibold">
            Server address
          </h2>
          <p className="text-[0.8125rem] leading-[1.1875rem] text-muted">Paste it into any AI app that connects to MCP servers.</p>
        </div>
        <div className="min-w-0 sm:ml-auto sm:max-w-160 sm:flex-1">
          <CodeBox text={serverUrl} what="the server address" copied="Server address copied" onCopy={askGuestToSignUp} />
        </div>
      </section>

      {connected.length > 0 ? (
        <section aria-labelledby="connected-apps">
          <div className={groupBarClass}>
            <h2 id="connected-apps" className="text-[0.9375rem] font-semibold">
              Connected apps
            </h2>
            <span className="font-mono text-2xs tabular-nums text-muted">{connected.length}</span>
          </div>
          <ul>
            {connected.map((app) => (
              <ConnectedAppRow key={app.id} app={app} onDisconnect={() => setAsking(app)} />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="ai-assistants">
        <div className={groupBarClass}>
          <h2 id="ai-assistants" className="text-[0.9375rem] font-semibold">
            AI assistants
          </h2>
          <span className="font-mono text-2xs tabular-nums text-muted">{apps.length}</span>
        </div>
        <ul>
          {apps.map((app) => (
            <AppRow
              key={app.id}
              app={app}
              serverUrl={serverUrl}
              open={openId === app.id}
              onToggle={askGuestToSignUp ?? (() => setOpenId((current) => (current === app.id ? null : app.id)))}
            />
          ))}
        </ul>
      </section>

      <ConfirmDialog
        open={asking !== null}
        kind="confirm"
        title={asking ? `Disconnect ${connectedName(asking)}?` : ""}
        message={asking ? `${connectedName(asking)} loses access to your AI Multi account right away. To use it again, connect it here.` : ""}
        confirmLabel="Disconnect"
        loading={busy}
        onConfirm={() => asking && void disconnect(asking)}
        onCancel={() => setAsking(null)}
      />
    </div>
  );
}
