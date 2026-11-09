import "server-only";
import { displayName, type Teammate } from "@/lib/direct-chats-core";
import { getTeammates, sharedProjects } from "@/lib/direct-chats";
import { prisma } from "@/lib/prisma";
import { normalizeUsername } from "@/lib/username";

/**
 * Who the owner or an admin can add to a project (#393, design 5B). Search
 * reaches only people they already share another project with, plus anyone by
 * their exact username: nobody can browse everyone in AI Multi, as the
 * Privacy Policy promises. Teammates join at once; anyone else gets an
 * invitation to accept.
 */

/** The user ids already in a project: its owner and the members with an account. */
async function peopleInProject(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true, members: { where: { userId: { not: null } }, select: { userId: true } } },
  });
  if (!project) return new Set<string>();
  return new Set([project.userId, ...project.members.flatMap((member) => (member.userId ? [member.userId] : []))]);
}

/** Everyone the user shares another project with who isn't in this one yet. */
export async function getAddableTeammates(projectId: string, userId: string): Promise<Teammate[]> {
  const [teammates, inProject] = await Promise.all([getTeammates(userId), peopleInProject(projectId)]);
  return teammates.filter((teammate) => !inProject.has(teammate.id));
}

/** Whether this person is already the project's owner or one of its members. */
export async function isInProject(projectId: string, userId: string) {
  return (await peopleInProject(projectId)).has(userId);
}

/**
 * The person with exactly this username, unless they're in the project already.
 * `teammate` says whether the user shares a project with them, so they can be added at once.
 */
export async function findByUsername(projectId: string, userId: string, value: string) {
  const username = normalizeUsername(value.replace(/^@/, ""));
  if (!username) return null;
  const person = await prisma.user.findUnique({ where: { username }, select: { id: true, name: true, email: true, username: true, isGuest: true } });
  if (!person || person.isGuest || person.id === userId || (await isInProject(projectId, person.id))) return null;
  const teammate = (await sharedProjects(userId, person.id)).length > 0;
  return { id: person.id, name: displayName(person), username: person.username!, teammate };
}
