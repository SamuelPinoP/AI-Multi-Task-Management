import type { Member } from "@/components/tasks/types";

/** Members of a project, for assignee pickers; cached per project for the session. */
const memberCache = new Map<string, Member[]>();

export async function loadProjectMembers(projectId: string) {
  const cached = memberCache.get(projectId);
  if (cached) return cached;
  const response = await fetch(`/api/projects/${projectId}`);
  if (!response.ok) return [];
  const project = (await response.json()) as { members?: Member[] };
  const members = project.members ?? [];
  memberCache.set(projectId, members);
  return members;
}
