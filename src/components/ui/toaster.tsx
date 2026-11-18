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
          // Sonner's own toasts get the app's look; custom ones (toast.custom, such as the AI bar's
          // "Moved to AI page", #308) draw their own.
          toast:
            "data-[styled=true]:!rounded-xl data-[styled=true]:!border-line data-[styled=true]:!bg-raised data-[styled=true]:!text-ink data-[styled=true]:!shadow-raised",
          description: "!text-muted",
          actionButton: "!bg-accent !text-accent-ink",
        },
      }}
    />
  );
}
