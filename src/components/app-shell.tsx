"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme-provider";
import { GlobalCommandCenter } from "./global-command-center";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/today", label: "Today" },
  { href: "/notes", label: "Notes" },
  { href: "/tasks", label: "Tasks" },
  { href: "/events", label: "Events" },
  { href: "/projects", label: "Projects" },
  { href: "/planner", label: "Planner" },
  { href: "/trash", label: "Trash" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <p className="font-semibold">AI-Multi Task-Management</p>
          <nav className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <GlobalCommandCenter />
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-lg px-3 py-2 text-sm transition ${
                    active
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
            <div className="shrink-0"><ThemeToggle /></div>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
