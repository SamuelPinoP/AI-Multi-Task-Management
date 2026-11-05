// Usernames (#351): a second way to log in besides the email, like GitHub's
// "Username or email address". Kept free of server-only imports, so the
// sign-up form, the Account page, the API routes and the unit tests share one
// set of rules.

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;

/** Under the field on the sign-up form and the Account page. */
export const USERNAME_RULES = "3 to 30 characters: letters and numbers, with single periods, hyphens or underscores between them.";

/**
 * The same rule for the browser's own check (the `pattern` attribute, which
 * must match the whole value). It allows capitals: they're saved in lowercase.
 */
export const USERNAME_INPUT_PATTERN = "[A-Za-z0-9](?:[A-Za-z0-9]|[._\\-](?=[A-Za-z0-9])){2,29}";

/** A letter or number first and last, and never two symbols in a row. */
const USERNAME_SHAPE = /^[a-z0-9](?:[a-z0-9]|[._-](?=[a-z0-9])){2,29}$/;

/**
 * Names that could pass for the app or its staff. Compared without their
 * periods, hyphens and underscores, so "a.d.m.i.n" is caught too.
 */
const RESERVED_USERNAMES = new Set([
  "abuse",
  "admin",
  "administrator",
  "aimulti",
  "guest",
  "help",
  "moderator",
  "noreply",
  "null",
  "official",
  "postmaster",
  "root",
  "security",
  "staff",
  "support",
  "system",
  "undefined",
  "webmaster",
]);

/** Usernames are compared and saved in lowercase, without surrounding spaces. */
export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

/**
 * The username to save, or why it can't be one, in words for the form.
 * `username` is `value` normalized either way.
 */
export function checkUsername(value: string): { username: string; error: string | null } {
  const username = normalizeUsername(value);
  const error = !username
    ? "Choose a username."
    : username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH
      ? `Usernames are ${USERNAME_MIN_LENGTH} to ${USERNAME_MAX_LENGTH} characters long.`
      : /[^a-z0-9._-]/.test(username)
        ? "Use only letters, numbers, periods, hyphens and underscores."
        : !USERNAME_SHAPE.test(username)
          ? "Start and end with a letter or number, and don't put two symbols together."
          : RESERVED_USERNAMES.has(username.replace(/[._-]/g, ""))
            ? "That username is reserved. Try another one."
            : null;
  return { username, error };
}

export const USERNAME_TAKEN_MESSAGE = "That username is taken. Try another one.";

/**
 * What was typed in the login form's "Email or username" field. An email
 * always has an @ and a username never does, so the two can't be confused.
 * Both are compared in lowercase.
 */
export function parseLoginIdentifier(value: string): { email: string } | { username: string } | null {
  const identifier = value.trim().toLowerCase();
  if (!identifier) return null;
  return identifier.includes("@") ? { email: identifier } : { username: identifier };
}
