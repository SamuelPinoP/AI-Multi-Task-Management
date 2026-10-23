"use client";

import { Copy, ExternalLink, Link2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { uiButtonClass, uiCardClass, uiPrimaryButtonClass } from "@/components/ui";
import { toast } from "@/components/ui/toaster";

const subscribeNever = () => () => {};

/** The owner's controls for the project's read-only share link (SMART-12). */
export function ProjectShare({ projectId, initialPath }: { projectId: string; initialPath: string | null }) {
  const [path, setPath] = useState(initialPath);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"replace" | "off" | null>(null);
  // The full address needs the browser's origin; the server render shows the path.
  const origin = useSyncExternalStore(subscribeNever, () => window.location.origin, () => "");
  const url = path ? `${origin}${path}` : "";

  async function request(method: "POST" | "DELETE") {
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/share`, { method });
      const body = (await response.json().catch(() => null)) as { path?: string | null; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Couldn't change the share link.");
      setPath(body?.path ?? null);
      toast.success(method === "DELETE" ? "Share link turned off" : "Share link ready", {
        description: method === "DELETE" ? "The old link no longer works." : "Anyone with the link can view the roadmap.",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't change the share link.");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy. Select the link and copy it instead.");
    }
  }

  return (
    <section className="mt-8" aria-labelledby="share-heading">
      <h2 id="share-heading" className="mb-4 text-2xl font-semibold">
        Share
      </h2>
      <div className={uiCardClass}>
        <p className="text-sm text-muted">
          A read-only roadmap for an advisor or a recruiter. Anyone with the link sees the project&apos;s name, description and
          progress, task titles with their status and due dates, upcoming events and the linked GitHub repository. Notes,
          chat, files, members, assignees and task descriptions stay private.
        </p>
        {path ? (
          <div className="mt-4 grid gap-3">
            <label className="grid gap-1.5 text-sm font-medium">
              Share link
              <input
                readOnly
                value={url || path}
                onFocus={(event) => event.target.select()}
                className="w-full rounded-lg border border-line bg-sunken px-3 py-2 font-mono text-xs text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void copy()} className={uiPrimaryButtonClass}>
                <Copy aria-hidden="true" className="h-4 w-4" />
                Copy link
              </button>
              <a href={path} target="_blank" rel="noopener noreferrer" className={uiButtonClass}>
                <ExternalLink aria-hidden="true" className="h-4 w-4" />
                Open
              </a>
              <button type="button" onClick={() => setConfirm("replace")} disabled={busy} className={uiButtonClass}>
                New link
              </button>
              <button type="button" onClick={() => setConfirm("off")} disabled={busy} className={uiButtonClass}>
                Turn off
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => void request("POST")} disabled={busy} className={`${uiPrimaryButtonClass} mt-4`}>
            <Link2 aria-hidden="true" className="h-4 w-4" />
            {busy ? "Creating..." : "Create share link"}
          </button>
        )}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "off" ? "Turn off the share link?" : "Replace the share link?"}
        message={
          confirm === "off"
            ? "The current link stops working right away. You can create a new one later."
            : "The current link stops working right away; send the new one to anyone who should still see the roadmap."
        }
        confirmLabel={confirm === "off" ? "Turn off" : "Replace link"}
        kind="confirm"
        loading={busy}
        onConfirm={() => void request(confirm === "off" ? "DELETE" : "POST")}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}
