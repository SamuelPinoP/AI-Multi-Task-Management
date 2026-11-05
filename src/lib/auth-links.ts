// Kept free of server-only imports so it can be unit tested with plain Node.

/** Where invitees answer their project invitations. */
export const INVITATIONS_PATH = "/projects";

type AuthPageParams = {
  error?: string;
  retry?: number;
  /** Filled in on the form. */
  email?: string;
  /** Where to go after logging in. "/" is the default, so it's left out. */
  next?: string;
};

/**
 * Links to the log in and sign up pages. Switching between them, or landing on
 * one after an error, keeps the email address and the page to return to.
 */
export function authPageHref(page: "login" | "signup", { error, retry, email, next }: AuthPageParams = {}) {
  const params = new URLSearchParams();
  if (error) params.set("error", error);
  if (retry !== undefined) params.set("retry", String(retry));
  if (email) params.set("email", email);
  if (next && next !== "/") params.set("next", next);
  const query = params.toString();
  return query ? `/${page}?${query}` : `/${page}`;
}

/** The page that waits for the email to be confirmed (#350); `next` is where it continues after. */
export const CONFIRM_EMAIL_PATH = "/verify-email";

/**
 * Links to the "Check your email" page. `status` says how a confirmation link
 * went, for a browser that isn't signed in to that account.
 */
export function confirmEmailHref({ next, status }: { next?: string; status?: "confirmed" | "invalid" } = {}) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (next && next !== "/") params.set("next", next);
  const query = params.toString();
  return query ? `${CONFIRM_EMAIL_PATH}?${query}` : CONFIRM_EMAIL_PATH;
}

/**
 * Where a project invitation email points: log in when the address already has
 * an account, sign up when it doesn't, then on to the invitations either way.
 */
export function invitationHref(email: string, hasAccount: boolean) {
  return authPageHref(hasAccount ? "login" : "signup", { email, next: INVITATIONS_PATH });
}
