"use client";

import { FormEvent, useState } from "react";
import {
  uiButtonClass,
  uiCardClass,
  uiDangerButtonClass,
} from "@/components/ui";

type Role = "OWNER" | "EDITOR" | "VIEWER";
type Member = {
  id: string;
  userId: string | null;
  name: string;
  email: string | null;
  role: Role;
  user?: { id: string; name: string | null; email: string } | null;
};
type EmailDelivery = { status: "disabled" | "sent" | "failed"; message: string };

type ProjectTeamSectionProps = {
  projectId: string;
  initialMembers: Member[];
  isOwner: boolean;
};

export function ProjectTeamSection({
  projectId,
  initialMembers,
  isOwner,
}: ProjectTeamSectionProps) {
  const [members, setMembers] = useState<Member[]>(initialMembers);
  // The shell refreshes the page on coming back, bringing the server's latest
  // members, such as an invitation accepted on another device.
  const [shownMembers, setShownMembers] = useState(initialMembers);
  if (shownMembers !== initialMembers) {
    setShownMembers(initialMembers);
    setMembers(initialMembers);
  }
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [role, setRole] = useState<Exclude<Role, "OWNER">>("EDITOR");
  const [inviteRole, setInviteRole] = useState<Exclude<Role, "OWNER">>("EDITOR");
  const [error, setError] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");

  async function addMember(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/projects/${projectId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, role }),
    });
    const data = (await res.json().catch(() => null)) as {
      member?: Omit<Member, "userId">;
      invitation?: { invitedEmail: string } | null;
      email?: EmailDelivery | null;
      error?: string;
    } | null;
    if (!res.ok || !data?.member) {
      setInviteMessage("");
      return setError(
        data?.error ||
          "Could not add member. Check the name, email, and role, then try again.",
      );
    }
    const { member, invitation } = data;
    // New members are never linked to an account until they accept.
    setMembers((prev) => [...prev, { ...member, userId: null }]);
    setName("");
    setEmail("");
    setRole("EDITOR");
    setError("");
    const delivery =
      data.email?.status === "sent"
        ? ""
        : " No email went out, so they will see it on their Projects page after signing in with that address.";
    setInviteMessage(
      invitation
        ? `Invitation sent to ${invitation.invitedEmail}. ${member.name} gets access after accepting it.${delivery}`
        : "",
    );
  }

  async function inviteUser(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    const data = (await res.json().catch(() => null)) as {
      message?: string;
      error?: string;
    } | null;
    if (!res.ok) {
      setInviteMessage("");
      return setError(data?.error || "Could not send invitation");
    }
    setInviteEmail("");
    setInviteRole("EDITOR");
    setError("");
    setInviteMessage(
      data?.message ||
        "Invitation created. The user can accept it from their Projects page.",
    );
  }

  async function updateMemberRole(memberId: string, nextRole: Exclude<Role, "OWNER">) {
    const res = await fetch(`/api/projects/${projectId}/members/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: nextRole }),
    });
    if (!res.ok) return setError("Could not update member role.");
    const updated = (await res.json()) as Member;
    setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, role: updated.role } : m)));
    setError("");
  }

  async function removeMember(memberId: string) {
    const res = await fetch(`/api/projects/${projectId}/members/${memberId}`, {
      method: "DELETE",
    });
    if (!res.ok)
      return setError(
        "Could not remove member. Only removable non-owner members can be deleted.",
      );
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
  }

  return (
    <section aria-labelledby="members-heading" className="mt-8">
      <h2 id="members-heading" className="mb-4 text-2xl font-semibold">Members</h2>
      <div className={`${uiCardClass} p-4`}>
        {isOwner ? (
          <>
            <form
              onSubmit={inviteUser}
              className="mb-4 grid gap-3 md:grid-cols-[1fr_180px_auto]"
            >
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Invite collaborator by email
                </label>
                <input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="teammate@example.com"
                  className="w-full rounded-xl border px-3 py-2"
                  type="email"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Role</label>
                <select aria-label="Role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Exclude<Role, "OWNER">)} className="w-full rounded-xl border px-3 py-2">
                  <option value="EDITOR">Editor</option>
                  <option value="VIEWER">Viewer</option>
                </select>
              </div>
              <button type="submit" className={`${uiButtonClass} self-end`}>
                Invite collaborator
              </button>
            </form>
            {inviteMessage && (
              <p className="mb-3 text-sm text-success">
                {inviteMessage}
              </p>
            )}
            <form onSubmit={addMember} className="grid gap-3 md:grid-cols-4">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
                className="rounded-xl border px-3 py-2"
                required
              />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email (optional, sends an invitation)"
                className="rounded-xl border px-3 py-2"
              />
              <select aria-label="Role"
                value={role}
                onChange={(e) => setRole(e.target.value as Exclude<Role, "OWNER">)}
                className="rounded-xl border px-3 py-2"
              >
                <option value="EDITOR">Editor</option>
                <option value="VIEWER">Viewer</option>
              </select>
              <button type="submit" className={uiButtonClass}>
                Add member
              </button>
            </form>
          </>
        ) : null}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        {members.length === 0 ? (
          <p className={`${isOwner ? "mt-4 " : ""}text-sm text-muted`}>No members yet.</p>
        ) : (
          <ul className={`${isOwner ? "mt-4 " : ""}space-y-3`}>
            {members.map((m) => (
              <li key={m.id} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <strong>{m.name}</strong>
                  <span>({m.role})</span>
                  {m.email ? <span>• {m.email}</span> : null}
                  {isOwner && m.role !== "OWNER" && (
                    <span className="ml-auto flex items-center gap-2">
                      <select aria-label="Role" value={m.role} onChange={(e) => void updateMemberRole(m.id, e.target.value as Exclude<Role, "OWNER">)} className="rounded-lg border px-2 py-1 text-xs">
                        <option value="EDITOR">Editor</option>
                        <option value="VIEWER">Viewer</option>
                      </select>
                      <button
                        className={`${uiDangerButtonClass} px-2 py-0.5 text-xs`}
                        onClick={() => void removeMember(m.id)}
                      >
                        Remove
                      </button>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
