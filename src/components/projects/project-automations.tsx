"use client";

import { Trash2, Zap } from "lucide-react";
import { useState, type FormEvent } from "react";
import { uiCardClass, uiPrimaryButtonClass } from "@/components/ui";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import {
  AUTOMATION_RECIPES,
  recipeKey,
  type AutomationAction,
  type AutomationTrigger,
} from "@/lib/project-automations-core";

export type AutomationRule = {
  id: string;
  trigger: AutomationTrigger;
  action: AutomationAction;
  memberId: string | null;
  memberName: string | null;
  enabled: boolean;
  label: string;
};

const fieldClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

async function errorMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

/** "When a task moves to Done, email the owner" and similar rules (SMART-11). Owners change them; everyone sees them. */
export function ProjectAutomations({
  projectId,
  isOwner,
  initialRules,
  members,
}: {
  projectId: string;
  isOwner: boolean;
  initialRules: AutomationRule[];
  members: { id: string; name: string }[];
}) {
  const [rules, setRules] = useState(initialRules);
  const available = AUTOMATION_RECIPES.filter(
    (recipe) => !rules.some((rule) => recipeKey(rule.trigger, rule.action) === recipeKey(recipe.trigger, recipe.action)),
  );
  const [choice, setChoice] = useState("");
  const [memberId, setMemberId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const selected = available.find((recipe) => recipeKey(recipe.trigger, recipe.action) === choice) ?? available[0];
  const needsMember = selected?.action === "ASSIGN_MEMBER";

  async function addRule(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if (needsMember && !memberId) {
      toast.error("Choose who gets new tasks.");
      return;
    }
    setBusy("add");
    try {
      const response = await fetch(`/api/projects/${projectId}/automations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: selected.trigger, action: selected.action, memberId: needsMember ? memberId : undefined }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not add the rule."));
      const rule = (await response.json()) as AutomationRule;
      setRules((current) => [...current, rule]);
      setChoice("");
      setMemberId("");
      toast.success("Automation added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add the rule.");
    } finally {
      setBusy(null);
    }
  }

  async function setEnabled(rule: AutomationRule, enabled: boolean) {
    setBusy(rule.id);
    try {
      const response = await fetch(`/api/projects/${projectId}/automations/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not change the rule."));
      const updated = (await response.json()) as AutomationRule;
      setRules((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change the rule.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteRule(rule: AutomationRule) {
    setBusy(rule.id);
    try {
      const response = await fetch(`/api/projects/${projectId}/automations/${rule.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not delete the rule."));
      setRules((current) => current.filter((item) => item.id !== rule.id));
      toast.success("Automation deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the rule.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-8" aria-labelledby="automations-heading">
      <h2 id="automations-heading" className="mb-4 text-2xl font-semibold">
        Automations
      </h2>
      <div className={uiCardClass}>
        <p className="text-sm text-muted">
          Rules that run on their own when tasks change. Subtasks don&apos;t trigger them, and the owner isn&apos;t emailed about
          their own changes.
        </p>

        {rules.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-line p-4 text-sm text-muted">
            {isOwner ? "No automations yet. Add one below." : "No automations yet. The project owner can add them."}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center gap-3 px-4 py-3">
                <Zap aria-hidden="true" className={cn("h-4 w-4 shrink-0", rule.enabled ? "text-accent" : "text-muted")} />
                <span className={cn("min-w-0 flex-1 text-sm", rule.enabled ? "text-ink" : "text-muted")}>{rule.label}</span>
                {isOwner ? (
                  <>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={rule.enabled}
                      aria-label={rule.label}
                      disabled={busy === rule.id}
                      onClick={() => void setEnabled(rule, !rule.enabled)}
                      className={cn(
                        "relative h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60",
                        rule.enabled ? "border-accent bg-accent" : "border-line bg-surface-hover",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-[left]",
                          rule.enabled ? "left-[1.375rem]" : "left-0.5",
                        )}
                      />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete rule: ${rule.label}`}
                      title="Delete rule"
                      disabled={busy === rule.id}
                      onClick={() => void deleteRule(rule)}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs text-muted">
                    {rule.enabled ? "On" : "Off"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {isOwner && selected ? (
          <form onSubmit={addRule} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={cn("grid gap-1.5 text-sm font-medium", needsMember ? "" : "sm:col-span-2")}>
                New rule
                <select
                  value={recipeKey(selected.trigger, selected.action)}
                  onChange={(event) => setChoice(event.target.value)}
                  className={fieldClass}
                >
                  {available.map((recipe) => (
                    <option key={recipeKey(recipe.trigger, recipe.action)} value={recipeKey(recipe.trigger, recipe.action)}>
                      {recipe.label}
                    </option>
                  ))}
                </select>
              </label>
              {needsMember ? (
                <label className="grid gap-1.5 text-sm font-medium">
                  Assign to
                  <select value={memberId} onChange={(event) => setMemberId(event.target.value)} className={fieldClass}>
                    <option value="">Choose a member</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={busy === "add" || (needsMember && members.length === 0)}
              className={cn(uiPrimaryButtonClass, "sm:w-auto")}
            >
              {busy === "add" ? "Adding..." : "Add rule"}
            </button>
            {needsMember && members.length === 0 ? (
              <p className="text-sm text-muted sm:col-span-2">Add a team member first; new tasks can only go to a member.</p>
            ) : null}
          </form>
        ) : null}
        {isOwner && !selected ? (
          <p className="mt-4 text-sm text-muted">Every kind of rule is already on this project.</p>
        ) : null}
      </div>
    </section>
  );
}
