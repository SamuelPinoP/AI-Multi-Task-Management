/** Cookie that remembers a collapsed sidebar, so the server renders it collapsed. */
export const SIDEBAR_COLLAPSED_COOKIE = "sidebar-collapsed";

/** Cookie that remembers which sidebar projects the user opened or closed, so the server renders them that way. */
export const SIDEBAR_PROJECTS_COOKIE = "sidebar-projects";

/** Project id → open. Projects without an entry are open only while you're on one of their pages. */
export type SidebarProjectsOpen = Record<string, boolean>;

/** Reads the cookie value ("id:1.id:0"), skipping anything malformed. */
export function parseSidebarProjects(value: string | undefined): SidebarProjectsOpen {
  const open: SidebarProjectsOpen = {};
  for (const entry of (value ?? "").split(".")) {
    const match = entry.match(/^([A-Za-z0-9_-]{1,64}):([01])$/);
    if (match) open[match[1]] = match[2] === "1";
  }
  return open;
}

/** The cookie value for the projects the sidebar still lists, so it never grows past them. */
export function serializeSidebarProjects(open: SidebarProjectsOpen, projectIds: string[]) {
  return projectIds
    .filter((id) => id in open)
    .map((id) => `${id}:${open[id] ? 1 : 0}`)
    .join(".");
}
