"use client";

/**
 * Adding people to a project (#393, design 5B): two tabs. "Already in Multi"
 * searches the people you share another project with, who join at once, and
 * anyone by their exact @username, who gets an invitation. "New to Multi"
 * invites by email. Either way the role picker says what each role does (3B),
 * and an invitation ends on a short confirmation: once they accept, they're in.
 */

import { CircleCheck } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { PersonAvatar } from "@/components/person-avatar";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import { nameMatches, sharedProjectsLine, type Teammate } from "@/lib/direct-chats-core";
import { PROJECT_ROLE_LABELS, type AssignableRole } from "@/lib/project-roles";
import type { ProjectMemberRow } from "@/components/projects/project-members";

/** One line under each role, like Asana's and Notion's role pickers (3B). */
export const ROLE_CHOICES: { value: AssignableRole; label: string; text: string }[] = [
  { value: "EDITOR", label: PROJECT_ROLE_LABELS.EDITOR, text: "Works on tasks, notes, events and chat." },
  { value: "ADMIN", label: PROJECT_ROLE_LABELS.ADMIN, text: "Also adds and removes members, and makes admins." },
];

type Found = { id: string; name: string; username: string; teammate: boolean };

/** Could the search be someone's username? Usernames are 3 to 30 letters, digits, periods, hyphens or underscores. */
function asUsername(query: string) {
  const value = query.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,29}$/.test(value) ? value : null;
}

export function AddPeopleDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  candidates,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  /** People the user shares another project with who aren't in this one. */
  candidates: Teammate[];
  onAdded: (member: ProjectMemberRow) => void;
}) {
  const [tab, setTab] = useState<"multi" | "new">("multi");
  const [query, setQuery] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>("EDITOR");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [done, setDone] = useState<Record<string, "added" | "invited">>({});
  // Who an invitation just went to; the confirmation shows while it's set.
  const [sentTo, setSentTo] = useState<string | null>(null);

  const username = tab === "multi" ? asUsername(query) : null;
  const matches = candidates.filter((person) => nameMatches(person.name, query.trim())).slice(0, 8);
  const showFound = found && !matches.some((person) => person.id === found.id);

  // An exact username, looked up once typing pauses.
  useEffect(() => {
    if (!username) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/people?username=${encodeURIComponent(username)}`, { signal: controller.signal });
        if (!response.ok) return;
        const data = (await response.json()) as { person: Found | null };
        setFound(data.person);
      } catch {
        // Typing again aborted it, or the network hiccuped: the next pause tries again.
      }
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [projectId, username]);

  function reset() {
    setTab("multi");
    setQuery("");
    setEmail("");
    setRole("EDITOR");
    setError("");
    setFound(null);
    setDone({});
  }

  async function addTeammate(person: { id: string; name: string }) {
    setBusy(person.id);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: person.id, role }),
      });
      const data = (await response.json().catch(() => null)) as { member?: ProjectMemberRow; error?: string } | null;
      if (!response.ok || !data?.member) throw new Error(data?.error || "Could not add them. Try again.");
      onAdded(data.member);
      setDone((current) => ({ ...current, [person.id]: "added" }));
      toast.success(`${person.name.split(" ")[0]} is in ${projectName}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add them. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function invite(target: { email: string } | { username: string; id: string }) {
    const key = "email" in target ? "email" : target.id;
    setBusy(key);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify("email" in target ? { email: target.email, role } : { username: target.username, role }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || "Could not send the invitation. Try again.");
      if ("email" in target) setEmail("");
      else setDone((current) => ({ ...current, [target.id]: "invited" }));
      onOpenChange(false);
      setSentTo("email" in target ? target.email.trim() : `@${target.username}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the invitation. Try again.");
    } finally {
      setBusy(null);
    }
  }

  /** One person in the results, with Add (teammates join at once) or Invite. A function, not a component, so React keeps the rows between renders. */
  function personRow(person: { id: string; name: string }, detail: string, action: "add" | "invite") {
    const state = done[person.id];
    return (
      <li key={person.id} className="flex items-center gap-3 py-2">
        <PersonAvatar id={person.id} name={person.name} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold">{person.name}</span>
          <span className="truncate text-xs text-muted">{detail}</span>
        </span>
        <button
          type="button"
          disabled={Boolean(state) || busy === person.id}
          onClick={() => (action === "add" ? void addTeammate(person) : found && void invite({ username: found.username, id: found.id }))}
          className={cn(state ? uiButtonClass : uiPrimaryButtonClass, "shrink-0 px-3 py-1.5 text-sm")}
        >
          {state === "added" ? "Added" : state === "invited" ? "Invited" : action === "add" ? "Add" : "Invite"}
          <span className="sr-only"> {person.name}</span>
        </button>
      </li>
    );
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          if (!next) reset();
          onOpenChange(next);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add people</DialogTitle>
          </DialogHeader>
          <div className="mt-3 grid gap-4">
            <div role="group" aria-label="Who" className="grid grid-cols-2 gap-0.5 rounded-xl bg-sunken p-1">
              {(
                [
                  ["multi", "Already in Multi"],
                  ["new", "New to Multi"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={tab === value}
                  onClick={() => {
                    setTab(value);
                    setError("");
                  }}
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
                    tab === value ? "bg-surface text-ink shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:text-ink",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "multi" ? (
              <div className="grid gap-2">
                <label className="grid gap-1.5 text-sm font-medium">
                  Search your teammates or an @username
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setFound(null);
                    }}
                    placeholder="Name or @username"
                    className="rounded-xl border border-line bg-surface px-3 py-2.5 text-base text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 sm:text-sm"
                  />
                </label>
                {matches.length || showFound ? (
                  <ul aria-label="People to add" className="max-h-64 divide-y divide-line overflow-y-auto">
                    {matches.map((person) => personRow(person, sharedProjectsLine(person.projects), "add"))}
                    {showFound && found ? personRow(found, `@${found.username}`, found.teammate ? "add" : "invite") : null}
                  </ul>
                ) : (
                  <p className="py-3 text-sm text-muted">
                    {query.trim() ? "Nobody in your projects matches. Use New to Multi to invite them by email." : "Nobody else from your projects to add yet."}
                  </p>
                )}
              </div>
            ) : (
              <form
                id="invite-by-email"
                onSubmit={(event: FormEvent) => {
                  event.preventDefault();
                  void invite({ email });
                }}
                className="grid gap-1.5"
              >
                <label className="grid gap-1.5 text-sm font-medium">
                  Their email
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="new.teammate@example.com"
                    className="rounded-xl border border-line bg-surface px-3 py-2.5 text-base text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 sm:text-sm"
                  />
                </label>
              </form>
            )}

            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">They join as</legend>
              {ROLE_CHOICES.map((choice) => (
                <label
                  key={choice.value}
                  className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3", role === choice.value ? "border-accent bg-accent-soft/40" : "border-line")}
                >
                  <input
                    type="radio"
                    name="add-people-role"
                    value={choice.value}
                    checked={role === choice.value}
                    onChange={() => setRole(choice.value)}
                    className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                  />
                  <span className="grid gap-0.5">
                    <span className="text-sm font-semibold">{choice.label}</span>
                    <span className="text-xs text-muted">{choice.text}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {error ? <p className="text-sm text-danger">{error}</p> : null}
            {tab === "new" ? (
              <button type="submit" form="invite-by-email" disabled={busy === "email"} className={cn(uiPrimaryButtonClass, "w-full py-2.5")}>
                {busy === "email" ? "Sending..." : "Send invite"}
              </button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {/* The confirmation after an invitation: nothing else to do. */}
      <Dialog open={sentTo !== null} onOpenChange={(next) => !next && (setSentTo(null), reset())}>
        <DialogContent className="max-w-sm" hideClose>
          <div className="grid justify-items-center gap-3 py-2 text-center">
            <CircleCheck aria-hidden="true" className="h-12 w-12 text-success" />
            <DialogTitle>Invite sent</DialogTitle>
            <DialogDescription>Once {sentTo} accepts, they&apos;re in.</DialogDescription>
            <button
              type="button"
              onClick={() => {
                setSentTo(null);
                reset();
              }}
              className={cn(uiPrimaryButtonClass, "mt-2 w-full py-2.5")}
            >
              Done
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
