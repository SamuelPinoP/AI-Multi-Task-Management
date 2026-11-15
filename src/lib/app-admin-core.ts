/**
 * Owner-only pages, such as the free-tier usage page (#286), open only for the accounts listed in
 * the optional ADMIN_EMAILS variable. Everyone else gets the same 404 as for a page that doesn't
 * exist. The addresses live in the environment, never in the code, because the repository is public.
 */

type AdminCandidate = { email: string; isGuest: boolean; emailVerifiedAt: Date | null };

/** ADMIN_EMAILS as lowercase addresses. Commas, semicolons and spaces all separate them; unset means nobody. */
export function parseAdminEmails(value: string | undefined): ReadonlySet<string> {
  return new Set(
    (value ?? "")
      .split(/[\s,;]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Whether the account may open owner-only pages: its address is listed (in any case) and it has
 * proved it owns that address. Guests never may: they have no address of their own.
 */
export function isAppAdminAccount(user: AdminCandidate | null | undefined, adminEmails: ReadonlySet<string>) {
  if (!user || user.isGuest || !user.emailVerifiedAt) return false;
  return adminEmails.has(user.email.trim().toLowerCase());
}
