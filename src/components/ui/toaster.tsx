"use client";

import { useSyncExternalStore } from "react";
import { Toaster as SonnerToaster } from "sonner";
import { useTheme } from "@/components/theme-provider";

export { toast } from "sonner";

const subscribeNever = () => () => {};

export function Toaster() {
  const { theme } = useTheme();
  // The server can't know the saved theme, so mount after hydration.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);

  if (!mounted) return null;

  return (
    <SonnerToaster
      theme={theme}
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast: "!rounded-xl !border-line !bg-raised !text-ink !shadow-raised",
          description: "!text-muted",
          actionButton: "!bg-accent !text-accent-ink",
        },
      }}
    />
  );
}
