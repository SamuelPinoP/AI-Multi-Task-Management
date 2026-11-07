"use client";

import { useSyncExternalStore } from "react";
import { sortLabels, type Label } from "@/lib/labels";

/**
 * The labels the pickers and filters use (#276), loaded once per page visit
 * and kept in sync with creates, renames and deletes made here. A scope is a
 * project id, or "none" for the user's personal labels.
 */
export type LabelScopeKey = string;

let all: Label[] | null = null;
let request: Promise<Label[]> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function set(next: Label[]) {
  all = sortLabels(next);
  emit();
}

/** Every label the user can see; loads them on first use, and again when `force`d. */
export function loadLabels(force = false): Promise<Label[]> {
  if (all && !force) return Promise.resolve(all);
  if (request && !force) return request;
  const current: Promise<Label[]> = fetch("/api/labels", { cache: "no-store" })
    .then(async (response) => (response.ok ? ((await response.json()) as Label[]) : null))
    .catch(() => null)
    .then((labels) => {
      // A failed load keeps what's shown; only the latest request writes.
      if (labels && request === current) set(labels);
      return labels ?? all ?? [];
    });
  request = current;
  return current;
}

export function scopeKeyFor(projectId: string | null | undefined): LabelScopeKey {
  return projectId || "none";
}

export function labelsInScope(labels: readonly Label[], scope: LabelScopeKey) {
  return labels.filter((label) => (label.projectId ?? "none") === scope);
}

/** The labels loaded so far, read outside a render (in an event handler). `null` until the first load. */
export function currentLabels() {
  return all;
}

/** The labels loaded so far, re-rendering when they change. `null` until the first load. */
export function useLabels() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => all,
    () => null,
  );
}

async function readError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

/** Creates a label in a scope. A name that exists already returns that label instead. */
export async function createLabel(name: string, scope: LabelScopeKey, color?: string): Promise<{ label?: Label; error?: string }> {
  const response = await fetch("/api/labels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, ...(color ? { color } : {}), ...(scope === "none" ? {} : { projectId: scope }) }),
  });
  if (response.status === 409) {
    const body = (await response.json().catch(() => null)) as { label?: Label; error?: string } | null;
    if (body?.label) return { label: body.label };
    return { error: body?.error ?? "That label already exists." };
  }
  if (!response.ok) return { error: await readError(response, "Could not create the label.") };
  const label = (await response.json()) as Label;
  set([...(all ?? []), label]);
  return { label };
}

export async function updateLabel(id: string, change: { name?: string; color?: string }): Promise<string | null> {
  const response = await fetch(`/api/labels/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(change),
  });
  if (!response.ok) return readError(response, "Could not change the label.");
  const label = (await response.json()) as Label;
  set((all ?? []).map((item) => (item.id === id ? label : item)));
  return null;
}

export async function deleteLabel(id: string): Promise<string | null> {
  const response = await fetch(`/api/labels/${id}`, { method: "DELETE" });
  if (!response.ok) return readError(response, "Could not delete the label.");
  set((all ?? []).filter((item) => item.id !== id));
  return null;
}
