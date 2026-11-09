/**
 * Direct messages (#387): the pure parts, shared by the server, the Chats
 * page and the unit tests. No server-only imports.
 *
 * Two people may start a direct chat, or send in one, only while they share a
 * project (its owner or a member with an account). Either can always read a
 * chat they're in.
 */

/** The two user ids of a direct chat in storage order: the smaller one first, so a pair has one chat. */
export function directChatPair(a: string, b: string): { userAId: string; userBId: string } {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
}

/** Someone you share at least one project with. */
export type Teammate = {
  id: string;
  name: string;
  /** The projects you share, by name, for "In Capstone launch and Website refresh". */
  projects: string[];
};

/** A person's display name: their name, or their email's local part. */
export function displayName(user: { name: string | null; email: string }) {
  return user.name?.trim() || user.email.split("@")[0] || user.email;
}

/** "In Capstone", "In Capstone and Sprint", "In Capstone, Sprint and 2 more". */
export function sharedProjectsLine(projects: string[]) {
  if (projects.length === 0) return "";
  if (projects.length === 1) return `In ${projects[0]}`;
  if (projects.length === 2) return `In ${projects[0]} and ${projects[1]}`;
  return `In ${projects[0]}, ${projects[1]} and ${projects.length - 2} more`;
}

/** Up to two initials: "Ana Torres" is AT, "maya" is M, "@ana_t" is A (symbols are skipped). */
export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => word.match(/[\p{L}\p{N}]/u)?.[0] ?? "")
    .filter(Boolean)
    .slice(0, 2)
    .map((letter) => letter.toUpperCase())
    .join("");
}

/**
 * Merges what each project tells about who is in it into one entry per person,
 * leaving out the user themselves. Projects come in the order given; each
 * person's project names keep that order.
 */
export function teammatesFrom(
  projects: { name: string; people: { id: string; name: string | null; email: string }[] }[],
  userId: string,
): Teammate[] {
  const byId = new Map<string, Teammate>();
  for (const project of projects) {
    for (const person of project.people) {
      if (person.id === userId) continue;
      const known = byId.get(person.id);
      if (known) {
        if (!known.projects.includes(project.name)) known.projects.push(project.name);
      } else {
        byId.set(person.id, { id: person.id, name: displayName(person), projects: [project.name] });
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether a search matches a name: every word typed starts a word of the name, in any case. */
export function nameMatches(name: string, query: string) {
  const words = name.toLowerCase().split(/\s+/).filter(Boolean);
  const typed = query.toLowerCase().split(/\s+/).filter(Boolean);
  return typed.every((part) => words.some((word) => word.startsWith(part)));
}
