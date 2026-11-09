/**
 * Project roles (#385): who may manage a project's people. Pure, so the API
 * routes, the pages and the unit tests share one set of rules.
 *
 * - The owner created the project. They can do everything below, and they
 *   alone dismiss an admin or remove one.
 * - Admins invite people, add and remove members, and make members admins.
 * - Everyone else is a member (stored as EDITOR). Every member edits the project's content.
 *
 * Viewer is gone: a member row still holding VIEWER (made by the old code
 * while the new one deployed) counts as an editor until #388 drops the value.
 */

export type ProjectRole = "OWNER" | "ADMIN" | "EDITOR";

/** The roles an invitation or a member can be given. */
export type AssignableRole = "ADMIN" | "EDITOR";

/** How roles read in the app; the stored EDITOR reads as Member (#386, design 3B). */
export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  EDITOR: "Member",
};

/** A member row's role as access: ADMIN stays ADMIN; EDITOR, and the legacy VIEWER and OWNER rows, are editors. */
export function memberRole(role: string): Exclude<ProjectRole, "OWNER"> {
  return role === "ADMIN" ? "ADMIN" : "EDITOR";
}

/**
 * Reads the role a request asks for: "ADMIN" or "EDITOR". A missing role
 * means EDITOR unless `required`; anything else, Viewer included, is null.
 */
export function parseAssignableRole(value: unknown, { required = false }: { required?: boolean } = {}): AssignableRole | null {
  if (value === undefined || value === null || value === "") return required ? null : "EDITOR";
  return value === "ADMIN" || value === "EDITOR" ? value : null;
}

/** The owner and admins invite people and add, remove and promote members. */
export function canManageMembers(actor: ProjectRole | null | undefined): boolean {
  return actor === "OWNER" || actor === "ADMIN";
}

/** Whether `actor` may remove a member whose row holds `target`: the owner removes anyone, an admin only editors. */
export function canRemoveMember(actor: ProjectRole | null | undefined, target: string): boolean {
  if (actor === "OWNER") return true;
  return actor === "ADMIN" && memberRole(target) === "EDITOR";
}

/**
 * Whether `actor` may give a member whose row holds `from` the role `to`.
 * Admins make editors admins; only the owner turns an admin back into an editor.
 */
export function canChangeRole(actor: ProjectRole | null | undefined, from: string, to: AssignableRole): boolean {
  if (actor === "OWNER") return true;
  if (actor !== "ADMIN") return false;
  return memberRole(from) === "EDITOR" && (to === "ADMIN" || to === "EDITOR");
}
