import { notFound, redirect } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { visibleTaskWhere } from "@/lib/task-include";
import { parseTaskNumberQuery } from "@/lib/task-number";

type TaskNumberPageProps = { params: Promise<{ number: string }> };

/**
 * A task's short, permanent address (#486): /t/142 opens AM-142's page for anyone who can see the
 * task, wherever it has moved. Everyone else gets the usual 404, so the address never says whether
 * a task with that number exists. Signed-out visitors log in first and come back here.
 */
export default async function TaskNumberPage({ params }: TaskNumberPageProps) {
  const user = await requirePageUser();
  const number = parseTaskNumberQuery((await params).number);
  const task = number === null ? null : await prisma.task.findFirst({ where: { number, ...visibleTaskWhere(user.id) }, select: { id: true } });
  if (!task) notFound();
  redirect(`/tasks/${task.id}`);
}
