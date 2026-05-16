import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

const DEMO_USER_EMAIL = "samuel@example.com";

type ProjectDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const { id } = await params;

  const project = await prisma.project.findFirst({
    where: {
      id,
      user: { email: DEMO_USER_EMAIL },
    },
    include: {
      notes: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          content: true,
        },
      },
    },
  });

  if (!project) {
    notFound();
  }

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <Link href="/projects" className="mb-6 inline-block text-sm underline">
          ← Back to projects
        </Link>

        <section className="rounded-2xl border border-zinc-200 p-6 shadow-sm dark:border-zinc-800">
          <h1 className="text-3xl font-bold">{project.name}</h1>
          {project.description ? (
            <p className="mt-2 text-zinc-700 dark:text-zinc-300">{project.description}</p>
          ) : (
            <p className="mt-2 text-zinc-500">No description.</p>
          )}

          <div className="mt-4 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
            <span className="inline-block h-3 w-3 rounded-full border border-zinc-300 dark:border-zinc-700" style={{ backgroundColor: project.color || "transparent" }} />
            <span>{project.color || "No color"}</span>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="mb-4 text-2xl font-semibold">Assigned Notes</h2>
          {project.notes.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-zinc-300 p-5 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
              No notes are assigned to this project yet.
            </p>
          ) : (
            <div className="space-y-4">
              {project.notes.map((note) => (
                <article key={note.id} className="rounded-2xl border border-zinc-200 p-5 shadow-sm dark:border-zinc-800">
                  <h3 className="text-lg font-semibold">{note.title}</h3>
                  <p className="mt-2 text-zinc-700 dark:text-zinc-300">{note.content || "No content."}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
