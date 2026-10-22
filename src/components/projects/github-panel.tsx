"use client";

import { ExternalLink, GitPullRequest, CircleDot, Star, GitFork } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { uiButtonClass, uiCardClass, uiPrimaryButtonClass } from "@/components/ui";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import { githubRepoUrl, type GithubItem, type GithubSummary } from "@/lib/github-core";

type PanelData = { repo: string | null; summary?: GithubSummary; message?: string };

const fieldClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25";

function formatDay(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}

function ItemList({ title, icon: Icon, items, empty }: { title: string; icon: typeof CircleDot; items: GithubItem[]; empty: string }) {
  return (
    <div className="min-w-0">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Icon aria-hidden="true" className="h-4 w-4 text-muted" />
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-2">
          {items.map((item) => (
            <li key={item.number} className="border-t border-line py-2 first:border-t-0">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-sm font-medium hover:text-accent hover:underline"
              >
                #{item.number} {item.title}
              </a>
              <p className="text-xs text-muted">
                {item.draft ? "Draft · " : ""}
                {item.author ? `${item.author} · ` : ""}
                {item.updatedAt ? `updated ${formatDay(item.updatedAt)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The linked GitHub repository's open pull requests and issues (SMART-12).
 * `endpoint` serves the data: the project's API for members, the share
 * link's for the public page. With `manageProjectId` the owner can link,
 * change or unlink the repository.
 */
export function GithubPanel({ endpoint, repo: initialRepo, manageProjectId }: { endpoint: string; repo: string | null; manageProjectId?: string }) {
  const [repo, setRepo] = useState(initialRepo);
  const [data, setData] = useState<PanelData | null>(null);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repo) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(endpoint, { signal: controller.signal });
        const body = (await response.json().catch(() => null)) as (PanelData & { error?: string }) | null;
        if (!response.ok || !body) throw new Error(body?.error ?? "Couldn't load the repository.");
        setData(body);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setData({ repo, message: loadError instanceof Error ? loadError.message : "Couldn't load the repository." });
      }
    })();
    return () => controller.abort();
  }, [endpoint, repo]);

  async function link(event: FormEvent) {
    event.preventDefault();
    if (!manageProjectId) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${manageProjectId}/github`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: input }),
      });
      const body = (await response.json().catch(() => null)) as { repo?: string; checked?: boolean; error?: string } | null;
      if (!response.ok || !body?.repo) throw new Error(body?.error ?? "Couldn't link the repository.");
      setData(null);
      setRepo(body.repo);
      setInput("");
      toast.success("Repository linked", {
        description: body.checked ? body.repo : `${body.repo}. GitHub couldn't be checked right now; the panel retries on its own.`,
      });
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "Couldn't link the repository.");
    } finally {
      setSaving(false);
    }
  }

  async function unlink() {
    if (!manageProjectId) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/projects/${manageProjectId}/github`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      setRepo(null);
      setData(null);
      toast.success("Repository unlinked");
    } catch {
      toast.error("Couldn't unlink the repository.");
    } finally {
      setSaving(false);
    }
  }

  if (!repo && !manageProjectId) return null;

  const summary = data?.summary;
  return (
    <section className="mt-8" aria-labelledby="github-heading">
      <h2 id="github-heading" className="mb-4 text-2xl font-semibold">
        GitHub
      </h2>
      <div className={uiCardClass}>
        {!repo ? (
          <form onSubmit={link} className="grid gap-3">
            <p className="text-sm text-muted">
              Link a public repository to show its open pull requests and issues here and on the share page.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="sr-only" htmlFor="github-repo">
                Repository
              </label>
              <input
                id="github-repo"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="owner/name or https://github.com/owner/name"
                className={fieldClass}
              />
              <button type="submit" disabled={saving || !input.trim()} className={cn(uiPrimaryButtonClass, "shrink-0")}>
                {saving ? "Linking..." : "Link repository"}
              </button>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
          </form>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <a
                  href={summary?.url ?? githubRepoUrl(repo)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-lg font-semibold hover:text-accent hover:underline"
                >
                  {summary?.repo ?? repo}
                  <ExternalLink aria-hidden="true" className="h-4 w-4" />
                  <span className="sr-only">(opens GitHub in a new tab)</span>
                </a>
                {summary?.description ? <p className="mt-1 text-sm text-muted">{summary.description}</p> : null}
                {summary ? (
                  <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    <span className="inline-flex items-center gap-1">
                      <Star aria-hidden="true" className="h-3.5 w-3.5" />
                      {summary.stars} {summary.stars === 1 ? "star" : "stars"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <GitFork aria-hidden="true" className="h-3.5 w-3.5" />
                      {summary.forks} {summary.forks === 1 ? "fork" : "forks"}
                    </span>
                    <span>{summary.openItems} open issues and pull requests</span>
                    {summary.archived ? <span>Archived</span> : null}
                  </p>
                ) : null}
              </div>
              {manageProjectId ? (
                <button type="button" onClick={() => void unlink()} disabled={saving} className={uiButtonClass}>
                  Unlink
                </button>
              ) : null}
            </div>
            {!data ? (
              <p className="mt-4 text-sm text-muted" role="status">
                Loading from GitHub...
              </p>
            ) : summary ? (
              <div className="mt-4 grid gap-6 md:grid-cols-2">
                <ItemList title="Open pull requests" icon={GitPullRequest} items={summary.pulls} empty="No open pull requests." />
                <ItemList title="Open issues" icon={CircleDot} items={summary.issues} empty="No open issues." />
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted" role="status">
                {data.message}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
