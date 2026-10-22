/** Path matching and page titles for the app shell's sidebar, bottom tabs and top bar. */

export type NavMatch = {
  href: string;
  /** Only the exact path counts (for example /events, but not /events/calendar). */
  exact?: boolean;
  /** Extra paths that count as this item (for example /tasks/board for Boards). */
  match?: string[];
};

export function isNavItemActive(pathname: string, item: NavMatch) {
  const paths = [item.href, ...(item.match ?? [])];
  return paths.some((path) =>
    path === "/" || item.exact ? pathname === path : pathname === path || pathname.startsWith(`${path}/`),
  );
}

// Longer prefixes first, so /tasks/board wins over /tasks.
const pageTitles: Array<[prefix: string, title: string]> = [
  ["/today", "My day"],
  ["/chats", "Chats"],
  ["/tasks/board", "Boards"],
  ["/tasks", "Tasks"],
  ["/events/calendar", "Calendar"],
  ["/events", "Events"],
  ["/notes", "Notes"],
  ["/board", "Boards"],
  ["/projects", "Projects"],
  ["/planner", "Planner"],
  ["/goals", "Goals"],
  ["/roadmap", "Roadmap"],
  ["/trash", "Trash"],
];

/** The top bar's title; project pages show "Projects / <name>". */
export function pageTitleFor(pathname: string, projects: Array<{ id: string; name: string }>): { parent?: string; title: string } {
  const projectMatch = pathname.match(/^\/projects\/([^/]+)/);
  if (projectMatch) {
    return { parent: "Projects", title: projects.find((project) => project.id === projectMatch[1])?.name ?? "Project" };
  }
  if (pathname === "/") return { title: "Home" };
  const found = pageTitles.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return { title: found?.[1] ?? "" };
}
