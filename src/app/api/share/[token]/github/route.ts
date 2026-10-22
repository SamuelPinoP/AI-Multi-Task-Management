import { NextResponse } from "next/server";
import { fetchGithubSummary } from "@/lib/github";
import { describeGithubProblem } from "@/lib/github-core";
import { findSharedProject } from "@/lib/project-share";

type RouteContext = { params: Promise<{ token: string }> };

/**
 * The GitHub panel of a public share page (SMART-12). Anyone with the link
 * may call it; it only shows public GitHub data, cached for 10 minutes.
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    const project = await findSharedProject(token, { githubRepo: true });
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const repo = project.githubRepo;
    if (!repo) return NextResponse.json({ repo: null });

    const result = await fetchGithubSummary(repo);
    if ("problem" in result) return NextResponse.json({ repo, problem: result.problem, message: describeGithubProblem(result.problem, repo) });
    return NextResponse.json({ repo, summary: result.summary });
  } catch (error) {
    console.error("GET /api/share/[token]/github error:", error);
    return NextResponse.json({ error: "Failed to load the repository" }, { status: 500 });
  }
}
