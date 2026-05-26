"use client";

import { FormEvent, useState } from "react";
import { uiButtonClass, uiCardClass, uiDangerButtonClass } from "@/components/ui";

type Role = "OWNER" | "MEMBER" | "VIEWER";
type Member = { id: string; name: string; email: string | null; role: Role };

export function ProjectTeamSection({ projectId, initialMembers }: { projectId: string; initialMembers: Member[] }) {
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("MEMBER");
  const [error, setError] = useState("");

  async function addMember(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/projects/${projectId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, role }) });
    if (!res.ok) return setError("Could not add member");
    const member = (await res.json()) as Member;
    setMembers((prev) => [...prev, member]);
    setName(""); setEmail(""); setRole("MEMBER"); setError("");
  }

  async function removeMember(memberId: string) {
    const res = await fetch(`/api/projects/${projectId}/members/${memberId}`, { method: "DELETE" });
    if (!res.ok) return setError("Could not remove member");
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
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
      <div className="mt-4 flex flex-wrap gap-2">{members.map((m)=><div key={m.id} className="rounded-full border px-3 py-1 text-sm">{m.name} ({m.role}) {m.email?`• ${m.email}`:""} {m.role!=="OWNER"&&<button className={`${uiDangerButtonClass} ml-2 px-2 py-0.5 text-xs`} onClick={()=>void removeMember(m.id)}>Remove</button>}</div>)}</div>
    </div>
  </section>;
}
