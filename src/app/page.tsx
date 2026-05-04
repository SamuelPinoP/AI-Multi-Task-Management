import Link from "next/link";
import { TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const DEMO_USER_EMAIL = "samuel@example.com";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export default async function DashboardPage() {
  const user = await prisma.user.findUnique({
    where: { email: DEMO_USER_EMAIL },
    select: { id: true },
  });

  const [recentNotes, upcomingTasks, totalNotes, totalTasks, activeTasks, completedTasks] = user
    ? await Promise.all([
        prisma.note.findMany({
          where: { userId: user.id, deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
        prisma.task.findMany({
          where: {
            userId: user.id,
            deletedAt: null,
            dueDate: { not: null },
            status: { not: TaskStatus.DONE },
          },
          orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
          take: 5,
        }),
        prisma.note.count({ where: { userId: user.id, deletedAt: null } }),
        prisma.task.count({ where: { userId: user.id, deletedAt: null } }),
        prisma.task.count({ where: { userId: user.id, deletedAt: null, status: { not: TaskStatus.DONE } } }),
        prisma.task.count({ where: { userId: user.id, deletedAt: null, status: TaskStatus.DONE } }),
      ])
    : [[], [], 0, 0, 0, 0];

  return <main className="min-h-screen  px-6 py-10 "><div className="mx-auto max-w-5xl"><h1 className="mb-2 text-4xl font-bold">Dashboard</h1><p className="mb-8 text-zinc-600 dark:text-zinc-300">Welcome to AI-Multi Task-Management. Here&apos;s a quick look at your productivity.</p><section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[{ label: "Total Notes", value: totalNotes }, { label: "Total Tasks", value: totalTasks }, { label: "Active Tasks", value: activeTasks }, { label: "Completed Tasks", value: completedTasks }].map((item) => (<article key={item.label} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 shadow-sm"><p className="text-sm text-zinc-500 dark:text-zinc-400">{item.label}</p><p className="mt-2 text-3xl font-semibold">{item.value}</p></article>))}</section><section className="mb-10 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm"><h2 className="mb-4 text-2xl font-semibold">Quick Actions</h2><div className="flex flex-wrap gap-3"><Link href="/notes" className="rounded-xl bg-zinc-900 dark:bg-zinc-100 px-5 py-3 text-white dark:text-zinc-900 transition hover:opacity-90">Go to Notes</Link><Link href="/tasks" className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-5 py-3 transition hover:bg-gray-50">Go to Tasks</Link><Link href="/events" className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-5 py-3 transition hover:bg-gray-50">Go to Events</Link><Link href="/trash" className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-5 py-3 transition hover:bg-gray-50">Go to Trash</Link></div></section><div className="grid gap-6 lg:grid-cols-2"><section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm"><h2 className="mb-4 text-2xl font-semibold">Recent Notes</h2>{!user ? <p className="text-zinc-600 dark:text-zinc-300">Demo user not found.</p> : recentNotes.length === 0 ? <p className="text-zinc-600 dark:text-zinc-300">No notes yet. Create one to get started.</p> : <ul className="space-y-3">{recentNotes.map((note) => (<li key={note.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4"><p className="font-medium">{note.title}</p>{note.content ? <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">{note.content}</p> : <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">No content.</p>}<p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Created {formatDate(note.createdAt)}</p></li>))}</ul>}</section><section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm"><h2 className="mb-4 text-2xl font-semibold">Upcoming Tasks</h2>{!user ? <p className="text-zinc-600 dark:text-zinc-300">Demo user not found.</p> : upcomingTasks.length === 0 ? <p className="text-zinc-600 dark:text-zinc-300">No upcoming tasks with due dates.</p> : <ul className="space-y-3">{upcomingTasks.map((task) => (<li key={task.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4"><div className="flex items-start justify-between gap-3"><p className="font-medium">{task.title}</p><span className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-2 py-1 text-xs text-zinc-700 dark:text-zinc-200">{task.priority}</span></div><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Status: {task.status.replace("_", " ")}</p>{task.dueDate && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Due {formatDate(task.dueDate)}</p>}</li>))}</ul>}</section></div></div></main>;
}
