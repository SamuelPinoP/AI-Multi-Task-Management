import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

export const uiCardClass = "rounded-2xl border border-line bg-surface p-6 shadow-card";

const uiButtonBase = "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

export const uiButtonClass = `${uiButtonBase} border border-line bg-surface text-ink hover:bg-surface-hover focus-visible:outline-accent`;

export const uiPrimaryButtonClass = `${uiButtonBase} bg-accent text-accent-ink hover:bg-accent-hover focus-visible:outline-accent`;

export const uiDangerButtonClass = `${uiButtonBase} border border-danger/30 bg-danger-soft text-danger hover:border-danger/50 focus-visible:outline-danger`;

export function BackLink({ href, children, className = "", ...rest }: ComponentProps<typeof Link> & { children: ReactNode }) {
  return (
    <Link href={href} className={`${uiButtonClass} gap-1.5 px-3 py-1.5 text-sm ${className}`.trim()} {...rest}>
      <ChevronLeft aria-hidden="true" className="h-4 w-4" />
      <span>{children}</span>
    </Link>
  );
}
