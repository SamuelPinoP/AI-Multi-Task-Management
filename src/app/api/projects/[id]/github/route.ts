import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { fetchGithubSummary, lookUpGithubRepo } from "@/lib/github";
import { describeGithubProblem, parseGithubRepo } from "@/lib/github-core";
import { prisma } from "@/lib/prisma";
import { getProjectAccess, isProjectOwner } from "@/lib/project-access";

type RouteContext = { params: Promise<{ id: string }> };

async function access(context: RouteContext, ownerOnly: boolean) {
  const user = await requireApiUser();
  if (!user) return { response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  const { id } = await context.params;
  const projectAccess = await getProjectAccess(id, user.id);
  if (!projectAccess) return { response: NextResponse.json({ error: "Project not found" }, { status: 404 }) };
  if (ownerOnly && !isProjectOwner(projectAccess)) {
    return { response: NextResponse.json({ error: "Only the project owner can change the linked repository." }, { status: 403 }) };
  }
  return { projectId: id };
}

/** The linked repository's latest open pull requests and issues (SMART-12); `{ repo: null }` when none is linked. */
export async function GET(_req: Request, context: RouteContext) {
  try {
    const check = await access(context, false);
    if ("response" in check) return check.response;
    const project = await prisma.project.findUnique({ where: { id: check.projectId }, select: { githubRepo: true } });
    const repo = project?.githubRepo ?? null;
    if (!repo) return NextResponse.json({ repo: null });

    const result = await fetchGithubSummary(repo);
    if ("problem" in result) return NextResponse.json({ repo, problem: result.problem, message: describeGithubProblem(result.problem, repo) });
    return NextResponse.json({ repo, summary: result.summary });
  } catch (error) {
    console.error("GET /api/projects/[id]/github error:", error);
    return NextResponse.json({ error: "Failed to load the repository" }, { status: 500 });
  }
}

/** Links a public repository: `{ repo: "owner/name" or a github.com URL }`. Owners only. */
export async function PUT(req: Request, context: RouteContext) {
  try {
    const check = await access(context, true);
    if ("response" in check) return check.response;
    const body = (await req.json().catch(() => null)) as { repo?: unknown } | null;
    const parsed = parseGithubRepo(body?.repo);
    if (!parsed) return NextResponse.json({ error: "Enter a repository as owner/name or paste its github.com address." }, { status: 400 });

    const lookup = await lookUpGithubRepo(parsed);
    if ("problem" in lookup && lookup.problem === "not-found") {
      return NextResponse.json({ error: describeGithubProblem("not-found", parsed) }, { status: 400 });
    }
    // GitHub busy or unreachable: link it anyway; the panel retries on its own.
    const repo = "repo" in lookup ? lookup.repo : parsed;
    await prisma.project.update({ where: { id: check.projectId }, data: { githubRepo: repo } });
    return NextResponse.json({ repo, checked: "repo" in lookup });
  } catch (error) {
    console.error("PUT /api/projects/[id]/github error:", error);
    return NextResponse.json({ error: "Failed to link the repository" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const check = await access(context, true);
    if ("response" in check) return check.response;
    await prisma.project.update({ where: { id: check.projectId }, data: { githubRepo: null } });
    return NextResponse.json({ repo: null });
  } catch (error) {
    console.error("DELETE /api/projects/[id]/github error:", error);
    return NextResponse.json({ error: "Failed to unlink the repository" }, { status: 500 });
  }
}
