"use client";

import { FormEvent, useMemo, useState } from "react";
import { uiButtonClass, uiCardClass, uiDangerButtonClass } from "@/components/ui";

type Role = "OWNER" | "MEMBER" | "VIEWER";
type NoteVisibility = "TEAM" | "PRIVATE";
type MemberNote = { id: string; message: string; createdAt: string; visibility: NoteVisibility; createdByUserId: string };
type Member = { id: string; userId: string | null; name: string; email: string | null; role: Role; notes: MemberNote[]; user?: { id: string; name: string | null; email: string } | null };
type PendingInvitation = { id: string; invitedEmail: string; status: "PENDING" | "ACCEPTED" | "DECLINED"; createdAt: string; invitedUser?: { name: string | null; email: string } | null };

type ProjectTeamSectionProps = {
  projectId: string;
  initialMembers: Member[];
  workloadRows: Array<[string, { name: string; active: number; completed: number; overdue: number }]>;
  isOwner: boolean;
  pendingInvitations: PendingInvitation[];
};

export function ProjectTeamSection({ projectId, initialMembers, workloadRows, isOwner, pendingInvitations }: ProjectTeamSectionProps) {
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [invitations, setInvitations] = useState<PendingInvitation[]>(pendingInvitations);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [role, setRole] = useState<Role>("MEMBER");
  const [error, setError] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [visibilityDrafts, setVisibilityDrafts] = useState<Record<string, NoteVisibility>>({});

  const workloadById = useMemo(() => new Map(workloadRows), [workloadRows]);
  const acceptedCollaborators = members.filter((member) => member.userId);

  async function addMember(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/projects/${projectId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, role }) });
    if (!res.ok) return setError("Could not add member");
    const member = (await res.json()) as Omit<Member, "notes">;
    setMembers((prev) => [...prev, { ...member, notes: [] }]);
    setName(""); setEmail(""); setRole("MEMBER"); setError("");
  }

  async function inviteUser(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail }),
    });
    const data = await res.json().catch(() => null) as PendingInvitation | { error?: string } | null;
    if (!res.ok) {
      setInviteMessage("");
      return setError(data && "error" in data && data.error ? data.error : "Could not send invitation");
    }
    setInvitations((prev) => [data as PendingInvitation, ...prev]);
    setInviteEmail("");
    setError("");
    setInviteMessage("Invitation created. The user can accept it from their Projects page.");
  }

  async function removeMember(memberId: string) {
    const res = await fetch(`/api/projects/${projectId}/members/${memberId}`, { method: "DELETE" });
    if (!res.ok) return setError("Could not remove member");
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
  }

  async function addNote(memberId: string) {
    const message = noteDrafts[memberId]?.trim() ?? "";
    if (!message) {
      setError("Member note message is required.");
      return;
    }
    const visibility = visibilityDrafts[memberId] ?? "TEAM";
    const res = await fetch(`/api/projects/${projectId}/members/${memberId}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, visibility }) });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      return setError(data?.error || "Could not add member note");
    }
    const note = (await res.json()) as MemberNote;
    setMembers((prev) => prev.map((member) => member.id === memberId ? { ...member, notes: [note, ...member.notes] } : member));
    setNoteDrafts((prev) => ({ ...prev, [memberId]: "" }));
    setVisibilityDrafts((prev) => ({ ...prev, [memberId]: "TEAM" }));
    setError("");
  }

  return <section className="mt-8"><h2 className="mb-4 text-2xl font-semibold">Team / Members</h2>
    <div className={`${uiCardClass} p-4`}>
      {isOwner ? <>
        <form onSubmit={inviteUser} className="mb-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <div>
            <label className="mb-1 block text-sm font-medium">Invite registered user by email</label>
            <input value={inviteEmail} onChange={(e)=>setInviteEmail(e.target.value)} placeholder="teammate@example.com" className="w-full rounded-xl border px-3 py-2" type="email" required />
          </div>
          <button type="submit" className={`${uiButtonClass} self-end`}>Invite collaborator</button>
        </form>
        {inviteMessage && <p className="mb-3 text-sm text-emerald-700 dark:text-emerald-300">{inviteMessage}</p>}
        <form onSubmit={addMember} className="grid gap-3 md:grid-cols-4">
          <input value={name} onChange={(e)=>setName(e.target.value)} placeholder="Name" className="rounded-xl border px-3 py-2" required />
          <input value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="Email (optional)" className="rounded-xl border px-3 py-2" />
          <select value={role} onChange={(e)=>setRole(e.target.value as Role)} className="rounded-xl border px-3 py-2"><option value="OWNER">OWNER</option><option value="MEMBER">MEMBER</option><option value="VIEWER">VIEWER</option></select>
          <button type="submit" className={uiButtonClass}>Add member</button>
        </form>
      </> : <p className="text-sm text-zinc-600 dark:text-zinc-300">You can view members, add member notes, and participate in project chat. Only the owner can invite or remove members.</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {isOwner && <section className="mt-5 rounded-xl border border-dashed p-3">
        <h3 className="text-sm font-semibold">Pending invitations</h3>
        {invitations.length === 0 ? <p className="mt-1 text-sm text-zinc-500">No pending invitations.</p> : <ul className="mt-2 space-y-1 text-sm text-zinc-600 dark:text-zinc-300">{invitations.map((invitation) => <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"><span>{invitation.invitedEmail}</span><span className="text-xs text-zinc-500">Pending since {new Date(invitation.createdAt).toLocaleDateString()}</span></li>)}</ul>}
      </section>}

      <section className="mt-5 rounded-xl border border-dashed p-3">
        <h3 className="text-sm font-semibold">Accepted collaborators</h3>
        {acceptedCollaborators.length === 0 ? <p className="mt-1 text-sm text-zinc-500">No accepted account collaborators yet.</p> : <ul className="mt-2 space-y-1 text-sm text-zinc-600 dark:text-zinc-300">{acceptedCollaborators.map((member) => <li key={member.id} className="rounded-lg border px-3 py-2">{member.user?.name || member.name} • {member.user?.email || member.email} <span className="ml-1 text-xs">({member.role})</span></li>)}</ul>}
      </section>

      <div className="mt-4 space-y-3">
        {members.map((m) => {
          const memberWorkload = workloadById.get(m.id) ?? { name: m.name, active: 0, completed: 0, overdue: 0 };
          return <article key={m.id} className="rounded-xl border p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm"><strong>{m.name}</strong><span>({m.role})</span>{m.email ? <span>• {m.email}</span> : null}{m.userId ? <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Account linked</span> : null}
              <span className="ml-auto text-xs text-zinc-600">Active: {memberWorkload.active} • Completed: {memberWorkload.completed} • Overdue: {memberWorkload.overdue}</span>
              {isOwner && m.role!=="OWNER"&&<button className={`${uiDangerButtonClass} px-2 py-0.5 text-xs`} onClick={()=>void removeMember(m.id)}>Remove</button>}
            </div>
            <div className="mt-2 flex gap-2">
              <input value={noteDrafts[m.id] ?? ""} onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [m.id]: e.target.value }))} placeholder={`Add note for ${m.name}`} className="w-full rounded-lg border px-3 py-1.5 text-sm" />
              <select value={visibilityDrafts[m.id] ?? "TEAM"} onChange={(e) => setVisibilityDrafts((prev) => ({ ...prev, [m.id]: e.target.value as NoteVisibility }))} className="rounded-lg border px-2 py-1.5 text-xs">
                <option value="TEAM">Team note</option>
                <option value="PRIVATE">Private note</option>
              </select>
              <button type="button" className={`${uiButtonClass} px-3 py-1.5 text-xs`} onClick={() => void addNote(m.id)}>Add note</button>
            </div>
            {m.notes.length > 0 ? <ul className="mt-2 space-y-1 text-xs text-zinc-600">{m.notes.map((note) => <li key={note.id} className="rounded border px-2 py-1">{note.message} {note.visibility === "PRIVATE" ? <span className="ml-1 rounded border border-purple-300 bg-purple-50 px-1 py-0.5 text-[10px] font-semibold text-purple-700">Private</span> : null}<span className="text-zinc-400"> • {new Date(note.createdAt).toLocaleString()}</span></li>)}</ul> : <p className="mt-2 text-xs text-zinc-500">No member notes yet.</p>}
          </article>;
        })}
      </div>
    </div>

    <section className="mt-8">
      <h2 className="mb-4 text-2xl font-semibold">Workload Summary</h2>
      <div className="overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800"><table className="min-w-full text-sm"><thead className="bg-zinc-100 dark:bg-zinc-900"><tr><th className="px-3 py-2 text-left">Member</th><th className="px-3 py-2 text-left">Active</th><th className="px-3 py-2 text-left">Completed</th><th className="px-3 py-2 text-left">Overdue</th></tr></thead><tbody>{workloadRows.map(([key, row])=><tr key={key} className="border-t border-zinc-200 dark:border-zinc-800"><td className="px-3 py-2">{row.name}</td><td className="px-3 py-2">{row.active}</td><td className="px-3 py-2">{row.completed}</td><td className="px-3 py-2">{row.overdue}</td></tr>)}</tbody></table></div>
    </section>
  </section>;
}
