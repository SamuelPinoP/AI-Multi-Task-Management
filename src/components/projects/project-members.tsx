"use client";

/**
 * A project's members (#386, design 1B): the owner first, then admins, then
 * everyone else, each with their role as a badge under the name (none for
 * plain members) and a Message button that opens your direct chat with them
 * (#387). The owner and admins get a menu per person with what the role rules
 * allow them (src/lib/project-roles.ts) and an Invite button whose role picker
 * says what each role does (3B). The rules show through the buttons, never as
 * text.
 */

import { Crown, MessageCircle, MoreHorizontal, ShieldCheck, UserPlus } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PersonAvatar } from "@/components/person-avatar";
import { uiButtonClass, uiCardClass, uiPrimaryButtonClass } from "@/components/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import {
  canChangeRole,
  canManageMembers,
  canRemoveMember,
  memberRole,
  PROJECT_ROLE_LABELS,
  type AssignableRole,
  type ProjectRole,
} from "@/lib/project-roles";

export type ProjectMemberRow = {
  id: string;
  /** Null for someone added by name before invitations (no account yet). */
  userId: string | null;
  name: string;
  /** As stored: ADMIN or EDITOR. */
  role: string;
};

type Row = {
  key: string;
  memberId: string | null;
  userId: string | null;
  name: string;
  role: ProjectRole;
  you: boolean;
};

/** One line under each role in the role picker (3B), like Asana's and Notion's. */
const ROLE_CHOICES: { value: AssignableRole; label: string; text: string }[] = [
  { value: "EDITOR", label: PROJECT_ROLE_LABELS.EDITOR, text: "Works on tasks, notes, events and chat." },
  { value: "ADMIN", label: PROJECT_ROLE_LABELS.ADMIN, text: "Also adds and removes members, and makes admins." },
];

const ROLE_ORDER: Record<ProjectRole, number> = { OWNER: 0, ADMIN: 1, EDITOR: 2 };

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

function RoleBadge({ role }: { role: ProjectRole }) {
  if (role === "EDITOR") return null;
  const owner = role === "OWNER";
  const Icon = owner ? Crown : ShieldCheck;
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold",
        owner ? "bg-accent-soft text-accent" : "border border-line bg-sunken text-ink",
      )}
    >
      <Icon aria-hidden="true" className="h-3 w-3" />
      {PROJECT_ROLE_LABELS[role]}
    </span>
  );
}

export function ProjectMembers({
  projectId,
  projectName,
  owner,
  initialMembers,
  viewerRole,
  currentUserId,
}: {
  projectId: string;
  projectName: string;
  /** The project's creator: their user id and display name. */
  owner: { id: string; name: string };
  initialMembers: ProjectMemberRow[];
  viewerRole: ProjectRole;
  currentUserId: string;
}) {
  const [members, setMembers] = useState(initialMembers);
  // The shell refreshes the page on coming back, bringing the server's latest
  // members, such as an invitation accepted on another device.
  const [shownMembers, setShownMembers] = useState(initialMembers);
  if (shownMembers !== initialMembers) {
    setShownMembers(initialMembers);
    setMembers(initialMembers);
  }
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AssignableRole>("EDITOR");
  const [inviteError, setInviteError] = useState("");
  const [inviting, setInviting] = useState(false);
  const canManage = canManageMembers(viewerRole);

  const rows: Row[] = [
    { key: `owner-${owner.id}`, memberId: null, userId: owner.id, name: owner.name, role: "OWNER" as const, you: owner.id === currentUserId },
    ...members.map((member) => ({
      key: member.id,
      memberId: member.id,
      userId: member.userId,
      name: member.name,
      role: memberRole(member.role),
      you: member.userId === currentUserId,
    })),
  ].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));

  async function changeRole(row: Row, role: AssignableRole) {
    if (!row.memberId) return;
    setBusyId(row.key);
    try {
      const response = await fetch(`/api/projects/${projectId}/members/${row.memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = (await response.json().catch(() => null)) as { role?: string; error?: string } | null;
      if (!response.ok || !data?.role) throw new Error(data?.error || "Could not change the role. Try again.");
      setMembers((current) => current.map((member) => (member.id === row.memberId ? { ...member, role: data.role! } : member)));
      toast.success(role === "ADMIN" ? `${firstName(row.name)} is now an admin` : `${firstName(row.name)} is no longer an admin`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change the role. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeMember(row: Row) {
    if (!row.memberId) return;
    setBusyId(row.key);
    try {
      const response = await fetch(`/api/projects/${projectId}/members/${row.memberId}`, { method: "DELETE" });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || "Could not remove them. Try again.");
      setMembers((current) => current.filter((member) => member.id !== row.memberId));
      toast.success(`${firstName(row.name)} was removed from ${projectName}`);
      setRemoving(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove them. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    setInviting(true);
    setInviteError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (!response.ok) {
        setInviteError(data?.error || "Could not send the invitation. Try again.");
        return;
      }
      toast.success(data?.message || `Invitation sent to ${inviteEmail.trim()}`);
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("EDITOR");
    } catch {
      setInviteError("Could not send the invitation. Check your connection and try again.");
    } finally {
      setInviting(false);
    }
  }

  return (
    <section aria-labelledby="members-heading" className={cn(uiCardClass, "mt-8 p-0")}>
      <div className="flex flex-wrap items-center gap-2 px-5 pb-2 pt-4">
        <h2 id="members-heading" className="text-xl font-semibold">
          Members
        </h2>
        <span className="text-sm text-muted">{rows.length}</span>
        {canManage ? (
          <button type="button" onClick={() => setInviteOpen(true)} className={cn(uiButtonClass, "ml-auto gap-1.5 border-accent px-3 py-1.5 text-sm font-semibold text-accent")}>
            <UserPlus aria-hidden="true" className="h-4 w-4" />
            Invite
          </button>
        ) : null}
      </div>

      <ul className="grid grid-cols-1 gap-x-4 px-2 pb-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => {
          const actions: { label: string; danger?: boolean; run: () => void }[] = [];
          if (row.memberId && !row.you) {
            if (row.role === "EDITOR" && canChangeRole(viewerRole, "EDITOR", "ADMIN")) {
              actions.push({ label: "Make admin", run: () => void changeRole(row, "ADMIN") });
            }
            if (row.role === "ADMIN" && canChangeRole(viewerRole, "ADMIN", "EDITOR")) {
              actions.push({ label: "Dismiss as admin", run: () => void changeRole(row, "EDITOR") });
            }
            if (canRemoveMember(viewerRole, row.role)) {
              actions.push({ label: "Remove from project", danger: true, run: () => setRemoving(row) });
            }
          }
          return (
            <li key={row.key} className="flex min-h-16 items-center gap-3 rounded-xl px-3 py-2">
              <PersonAvatar id={row.userId ?? row.key} name={row.name} />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-[0.9375rem] font-semibold">
                  {row.name}
                  {row.you ? <span className="font-normal text-muted"> (You)</span> : null}
                </span>
                <RoleBadge role={row.role} />
                {row.userId ? null : <span className="text-xs text-muted">No account yet</span>}
              </span>
              {row.userId && !row.you ? (
                <Link
                  href={`/chats?person=${row.userId}`}
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-sm font-semibold text-accent transition-colors hover:bg-accent hover:text-accent-ink"
                >
                  <MessageCircle aria-hidden="true" className="h-4 w-4" />
                  <span className="sr-only sm:not-sr-only">Message</span>
                  <span className="sr-only"> {firstName(row.name)}</span>
                </Link>
              ) : null}
              {actions.length ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`More for ${row.name}`}
                    disabled={busyId === row.key}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                  >
                    <MoreHorizontal aria-hidden="true" className="h-5 w-5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {actions.map((action) => (
                      <DropdownMenuItem key={action.label} onSelect={action.run} className={action.danger ? "text-danger" : undefined}>
                        {action.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={Boolean(removing)}
        title={removing ? `Remove ${removing.name}?` : "Remove member?"}
        message={`They lose access to ${projectName}: its tasks, notes, events and chat.`}
        confirmLabel="Remove"
        loading={Boolean(removing && busyId === removing.key)}
        onConfirm={() => removing && void removeMember(removing)}
        onCancel={() => setRemoving(null)}
      />

      <Dialog open={inviteOpen} onOpenChange={(open) => !inviting && setInviteOpen(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invite to {projectName}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(event) => void invite(event)} className="mt-2 grid gap-4">
            <label className="grid gap-1.5 text-sm font-medium">
              Email
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="teammate@example.com"
                className="rounded-xl border border-line bg-surface px-3 py-2.5 text-base text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 sm:text-sm"
              />
            </label>
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">Role</legend>
              {ROLE_CHOICES.map((choice) => (
                <label
                  key={choice.value}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-3",
                    inviteRole === choice.value ? "border-accent bg-accent-soft/40" : "border-line",
                  )}
                >
                  <input
                    type="radio"
                    name="invite-role"
                    value={choice.value}
                    checked={inviteRole === choice.value}
                    onChange={() => setInviteRole(choice.value)}
                    className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                  />
                  <span className="grid gap-0.5">
                    <span className="text-sm font-semibold">{choice.label}</span>
                    <span className="text-xs text-muted">{choice.text}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {inviteError ? <p className="text-sm text-danger">{inviteError}</p> : null}
            <button type="submit" disabled={inviting} className={cn(uiPrimaryButtonClass, "w-full py-2.5")}>
              {inviting ? "Sending..." : "Send invite"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
