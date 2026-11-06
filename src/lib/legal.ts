// The Privacy Policy and Terms of Service (#358): their addresses, contact and
// dates, shared by the pages, the links to them and the tests. Kept free of
// server-only imports.

export const PRIVACY_PATH = "/privacy";
export const TERMS_PATH = "/terms";

/** Where privacy questions and account deletion requests go; also the address the app's emails come from. */
export const LEGAL_CONTACT_EMAIL = "samuelpinopena@gmail.com";

/** Shown at the top of both documents. Change it with every edit to either. */
export const LEGAL_LAST_UPDATED = "November 5, 2026";

/**
 * Accounts are for adults: the planned Gemini assistant (#256) may not be part
 * of an app "likely to be accessed by individuals under the age of 18" (Gemini
 * API Additional Terms of Service).
 */
export const MINIMUM_AGE = 18;

/**
 * Google Search Console's "HTML tag" verification for this site, from
 * GOOGLE_SITE_VERIFICATION, as Next.js metadata. Verifying the domain lets
 * Google show the app's name and logo on its sign-in screen (#356).
 */
export function siteVerification(env: Record<string, string | undefined>) {
  const token = env.GOOGLE_SITE_VERIFICATION?.trim();
  return token ? { google: token } : undefined;
}
