"use client";

import { useState } from "react";
import { uiButtonClass } from "@/components/ui";
import { toast } from "@/components/ui/toaster";

/** "Log out of other devices" on the Account page (#354). */
export function AccountSessions({ otherDevices: initialOtherDevices }: { otherDevices: number }) {
  const [otherDevices, setOtherDevices] = useState(initialOtherDevices);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function logOutOtherDevices() {
    setWorking(true);
    setError("");
    try {
      const response = await fetch("/api/account/sessions", { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as { loggedOut?: number; error?: string };
      if (!response.ok || typeof data.loggedOut !== "number") {
        setError(data.error ?? "Could not log out of the other devices. Try again.");
        return;
      }
      toast.success(`Logged out of ${data.loggedOut} other device${data.loggedOut === 1 ? "" : "s"}`);
      setOtherDevices(0);
    } catch {
      setError("Could not log out of the other devices. Check your connection and try again.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="mt-4 grid gap-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
      <p className="text-sm text-ink">
        {otherDevices === 0 ? "Only this device is signed in." : `Signed in on ${otherDevices + 1} devices, including this one.`}
      </p>
      <button
        type="button"
        onClick={() => void logOutOtherDevices()}
        disabled={working || otherDevices === 0}
        className={uiButtonClass}
      >
        Log out of other devices
      </button>
      {error ? (
        <p role="alert" className="text-sm text-danger sm:basis-full">
          {error}
        </p>
      ) : null}
    </div>
  );
}
