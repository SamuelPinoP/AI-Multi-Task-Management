"use client";

import { useState, type FormEvent } from "react";
import { uiPrimaryButtonClass } from "@/components/ui";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import { normalizeUsername, USERNAME_INPUT_PATTERN, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_RULES } from "@/lib/username";

const fieldClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25 aria-[invalid=true]:border-danger!";

/** Adds or changes the username on the Account page (#351). */
export function AccountUsernameForm({ initialUsername }: { initialUsername: string | null }) {
  const [saved, setSaved] = useState(initialUsername);
  const [value, setValue] = useState(initialUsername ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const unchanged = normalizeUsername(value) === (saved ?? "");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: value }),
      });
      const data = (await response.json().catch(() => ({}))) as { username?: string; error?: string };
      if (!response.ok || !data.username) {
        setError(data.error ?? "Could not save the username. Try again.");
        return;
      }
      toast.success(saved ? "Username changed" : "Username saved", { description: `You can log in as ${data.username}.` });
      setSaved(data.username);
      setValue(data.username);
    } catch {
      setError("Could not save the username. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  // On phones the rules sit right under the field, above the button; from sm up the button joins the field's row.
  return (
    <form onSubmit={(event) => void save(event)} className="grid grid-cols-1 gap-x-2 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_auto]">
      <label htmlFor="account-username" className="text-sm font-medium sm:col-span-2">Username</label>
      <input
        id="account-username"
        name="username"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        minLength={USERNAME_MIN_LENGTH}
        maxLength={USERNAME_MAX_LENGTH}
        pattern={USERNAME_INPUT_PATTERN}
        title={USERNAME_RULES}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "account-username-hint account-username-error" : "account-username-hint"}
        className={cn(fieldClass, "sm:col-start-1 sm:row-start-2")}
      />
      <p id="account-username-hint" className="text-xs text-muted sm:col-span-2">
        {USERNAME_RULES} {saved ? "Your old username stops working, and someone else can take it." : null}
      </p>
      {error ? (
        <p id="account-username-error" role="alert" className="text-sm text-danger sm:col-span-2">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={saving || unchanged}
        className={cn(uiPrimaryButtonClass, "mt-1.5 sm:col-start-2 sm:row-start-2 sm:mt-0")}
      >
        {saved ? "Change username" : "Save username"}
      </button>
    </form>
  );
}
