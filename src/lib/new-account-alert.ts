import "server-only";

import { parseAdminEmails } from "@/lib/app-admin-core";
import { sendNewAccountEmail } from "@/lib/email";
import type { NewAccountMethod } from "@/lib/email-templates";

type NewAccount = { id: string; name: string | null; username: string | null; email: string };

/**
 * Emails each address in ADMIN_EMAILS that someone made an account (#429), once per account and never as
 * a digest. Guest workspaces don't count, and an admin isn't told about their own sign-up. Callers run it
 * inside after(), once the response is on its way, so it never slows a sign-up down or makes it fail.
 */
export async function alertAdminsOfNewAccount(account: NewAccount, method: NewAccountMethod, fallbackOrigin?: string) {
  const ownAddress = account.email.trim().toLowerCase();
  const recipients = [...parseAdminEmails(process.env.ADMIN_EMAILS)].filter((address) => address !== ownAddress);
  if (recipients.length === 0) return;

  const results = await Promise.allSettled(
    recipients.map((to) =>
      sendNewAccountEmail({ to, userId: account.id, name: account.name, username: account.username, email: account.email, method, fallbackOrigin }),
    ),
  );
  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("New account email failed.", { error: result.reason instanceof Error ? result.reason.message : "Unknown email error" });
    }
  }
}
