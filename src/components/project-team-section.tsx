"use client";

import { FormEvent, useMemo, useState } from "react";
import { uiButtonClass, uiCardClass, uiDangerButtonClass } from "@/components/ui";

type Role = "OWNER" | "MEMBER" | "VIEWER";
type MemberNote = { id: string; message: string; createdAt: string };
type Member = { id: string; name: string; email: string | null; role: Role; notes: MemberNote[] };

export function ProjectTeamSection({ projectId, initialMembers, workloadRows }: { projectId: string; initialMembers: Member[]; workloadRows: Array<[string, { name: string; active: number; completed: number; overdue: number }]> }) {
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("MEMBER");
  const [error, setError] = useState("");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const workloadById = useMemo(() => new Map(workloadRows), [workloadRows]);

  async function addMember(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/projects/${projectId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, role }) });
    if (!res.ok) return setError("Could not add member");
    const member = (await res.json()) as Omit<Member, "notes">;
    setMembers((prev) => [...prev, { ...member, notes: [] }]);
    setName(""); setEmail(""); setRole("MEMBER"); setError("");
  }

  async function removeMember(memberId: string) {
    const res = await fetch(`/api/projects/${projectId}/members/${memberId}`, { method: "DELETE" });
    if (!res.ok) return setError("Could not remove member");
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
  }

  async function addNote(memberId: string) {
    const message = noteDrafts[memberId]?.trim() ?? "";
    if (!message) return;
    const res = await fetch(`/api/projects/${projectId}/members/${memberId}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
    if (!res.ok) return setError("Could not add member note");
    const note = (await res.json()) as MemberNote;
    setMembers((prev) => prev.map((member) => member.id === memberId ? { ...member, notes: [note, ...member.notes] } : member));
    setNoteDrafts((prev) => ({ ...prev, [memberId]: "" }));
  }

  return <section className="mt-8"><h2 className="mb-4 text-2xl font-semibold">Team / Members</h2>
    <div className={`${uiCardClass} p-4`}>
      <form onSubmit={addMember} className="grid gap-3 md:grid-cols-4">
        <input value={name} onChange={(e)=>setName(e.target.value)} placeholder="Name" className="rounded-xl border px-3 py-2" required />
        <input value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="Email (optional)" className="rounded-xl border px-3 py-2" />
        <select value={role} onChange={(e)=>setRole(e.target.value as Role)} className="rounded-xl border px-3 py-2"><option value="OWNER">OWNER</option><option value="MEMBER">MEMBER</option><option value="VIEWER">VIEWER</option></select>
        <button type="submit" className={uiButtonClass}>Add member</button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-4 space-y-3">
        {members.map((m) => {
          const memberWorkload = workloadById.get(m.id) ?? { name: m.name, active: 0, completed: 0, overdue: 0 };
          return <article key={m.id} className="rounded-xl border p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm"><strong>{m.name}</strong><span>({m.role})</span>{m.email ? <span>• {m.email}</span> : null}
              <span className="ml-auto text-xs text-zinc-600">Active: {memberWorkload.active} • Completed: {memberWorkload.completed} • Overdue: {memberWorkload.overdue}</span>
              {m.role!=="OWNER"&&<button className={`${uiDangerButtonClass} px-2 py-0.5 text-xs`} onClick={()=>void removeMember(m.id)}>Remove</button>}
            </div>
            <div className="mt-2 flex gap-2"><input value={noteDrafts[m.id] ?? ""} onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [m.id]: e.target.value }))} placeholder={`Add note for ${m.name}`} className="w-full rounded-lg border px-3 py-1.5 text-sm" /><button type="button" className={`${uiButtonClass} px-3 py-1.5 text-xs`} onClick={() => void addNote(m.id)}>Add note</button></div>
            {m.notes.length > 0 ? <ul className="mt-2 space-y-1 text-xs text-zinc-600">{m.notes.map((note) => <li key={note.id} className="rounded border px-2 py-1">{note.message} <span className="text-zinc-400">• {new Date(note.createdAt).toLocaleString()}</span></li>)}</ul> : <p className="mt-2 text-xs text-zinc-500">No member notes yet.</p>}
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
