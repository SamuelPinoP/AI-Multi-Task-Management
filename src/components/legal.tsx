import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { LEGAL_CONTACT_EMAIL, LEGAL_LAST_UPDATED, PRIVACY_PATH, TERMS_PATH } from "@/lib/legal";

export const legalLinkClass = "font-medium text-ink underline underline-offset-4 hover:text-accent";
const linkClass = legalLinkClass;

/** "Privacy Policy · Terms of Service", for footers and settings (#358). */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted", className)}>
      <Link href={PRIVACY_PATH} className="hover:text-ink hover:underline">
        Privacy Policy
      </Link>
      <Link href={TERMS_PATH} className="hover:text-ink hover:underline">
        Terms of Service
      </Link>
    </nav>
  );
}

/** The line under sign-in and sign-up buttons that says what continuing agrees to. */
export function AgreementNotice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-xs leading-5 text-muted", className)}>
      {children} you agree to the{" "}
      <Link href={TERMS_PATH} className={linkClass}>
        Terms of Service
      </Link>{" "}
      and the{" "}
      <Link href={PRIVACY_PATH} className={linkClass}>
        Privacy Policy
      </Link>
      .
    </p>
  );
}

/** A section of a legal document, with a heading other pages can link to. */
export function LegalSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="scroll-mt-6 text-lg font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

export const legalListClass = "list-disc space-y-1.5 pl-5";

export function ContactLink() {
  return (
    <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className={linkClass}>
      {LEGAL_CONTACT_EMAIL}
    </a>
  );
}

/**
 * The Privacy Policy and Terms of Service pages: public, rendered on the
 * server, readable without signing in, as Google's checks expect (#358).
 */
export function LegalDocument({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
      <article className="space-y-8 text-sm leading-6 text-ink sm:text-base sm:leading-7">
        <header className="space-y-3">
          <p className="text-sm font-medium text-muted">
            <Link href="/" className="hover:text-ink hover:underline">
              AI Multi
            </Link>
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted">Last updated {LEGAL_LAST_UPDATED}</p>
          <div className="space-y-3 text-muted">{intro}</div>
        </header>
        {children}
        <footer className="border-t border-line pt-6">
          <LegalLinks />
        </footer>
      </article>
    </main>
  );
}

