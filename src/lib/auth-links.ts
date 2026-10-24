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

/**
 * Where a project invitation email points: log in when the address already has
 * an account, sign up when it doesn't, then on to the invitations either way.
 */
export function invitationHref(email: string, hasAccount: boolean) {
  return authPageHref(hasAccount ? "login" : "signup", { email, next: INVITATIONS_PATH });
}
