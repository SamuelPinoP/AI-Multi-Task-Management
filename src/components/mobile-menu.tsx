"use client";

import { Menu } from "lucide-react";
import { createContext, useContext } from "react";
import { cn } from "@/lib/cn";

/** What a page needs to open the app's menu sheet on phones and tablets; the app shell provides it. */
export type MobileMenu = {
  open: () => void;
  /** New notifications and invitations, shown as a dot on the button (#404). */
  news: number;
};

export const MobileMenuContext = createContext<MobileMenu | null>(null);

/**
 * The menu button of phones and tablets. The bar above a page holds it; a page whose own header is
 * its only bar, like the Chats list, holds it there instead (#420). Outside the app shell it draws nothing.
 */
export function MobileMenuButton({ className }: { className?: string }) {
  const menu = useContext(MobileMenuContext);
  if (!menu) return null;
  const { open, news } = menu;
  return (
    <button
      type="button"
      onClick={open}
      aria-label={news ? `Open navigation, ${news} new notification${news === 1 ? "" : "s"}` : "Open navigation"}
      className={cn("relative grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-ink", className)}
    >
      <Menu aria-hidden="true" className="h-5 w-5" />
      {news ? <span aria-hidden="true" className="absolute right-1 top-1 h-2 w-2 rounded-full border-2 border-surface bg-project-3" /> : null}
    </button>
  );
}
