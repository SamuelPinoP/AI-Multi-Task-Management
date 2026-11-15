import "server-only";

import { notFound } from "next/navigation";
import { isAppAdminAccount, parseAdminEmails } from "@/lib/app-admin-core";
import { getCurrentUser, type AuthUser } from "@/lib/auth";

/** Whether the user is one of the app's admins (ADMIN_EMAILS), read again on every request. */
export function isAppAdmin(user: AuthUser | null) {
  return isAppAdminAccount(user, parseAdminEmails(process.env.ADMIN_EMAILS));
}

/**
 * For owner-only pages: the signed-in admin, or the 404 of a page that doesn't exist. Signed out,
 * signed in as anyone else or with an ended session, a visitor can't tell the page is there.
 */
export async function requireAppAdminPage() {
  const user = await getCurrentUser();
  if (!user || !isAppAdmin(user)) notFound();
  return user;
}
