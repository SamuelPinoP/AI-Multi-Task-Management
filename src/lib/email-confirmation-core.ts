// Pure rules for confirmation emails (#350): how long a link works, how long to
// wait between emails, and how to say it. Kept free of server-only imports so
// it can be unit tested with plain Node and used in the browser.

/** How long a confirmation link works after it's sent. */
export const CONFIRMATION_LINK_TTL_MS = 24 * 60 * 60 * 1000;

/** The wait after each confirmation email before another may go to the same account. */
export const RESEND_COOLDOWN_SECONDS = 60;

/** The longest email address there can be (RFC 5321). */
export const EMAIL_MAX_LENGTH = 254;

/**
 * The link in the confirmation email. It confirms the address, then carries on
 * to `next`, such as the invitations an invitee signed up for.
 */
export function confirmationLinkUrl(baseUrl: string, token: string, next = "/") {
  const params = new URLSearchParams({ token });
  if (next !== "/") params.set("next", next);
  return `${baseUrl.replace(/\/+$/, "")}/api/auth/verify-email?${params}`;
}

/**
 * Seconds until another email may go to an account whose newest link was sent
 * at `lastSentAt`. Never more than the full wait, even if this server's clock is
 * a little behind the one that recorded the send.
 */
export function secondsUntilResend(lastSentAt: Date | null | undefined, now: Date) {
  if (!lastSentAt) return 0;
  const waitMs = lastSentAt.getTime() + RESEND_COOLDOWN_SECONDS * 1000 - now.getTime();
  return waitMs > 0 ? Math.min(RESEND_COOLDOWN_SECONDS, Math.ceil(waitMs / 1000)) : 0;
}

/** A countdown as clocks show it: "0:42", "12:05", "1:05:00". */
export function formatCountdown(totalSeconds: number) {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** "42 seconds", "15 minutes" or "3 hours", rounded up. */
export function waitPhrase(totalSeconds: number) {
  const seconds = Math.max(1, Math.ceil(totalSeconds));
  const [amount, unit] =
    seconds < 60 ? [seconds, "second"] : seconds < 90 * 60 ? [Math.ceil(seconds / 60), "minute"] : [Math.ceil(seconds / 3600), "hour"];
  return `${amount} ${unit}${amount === 1 ? "" : "s"}`;
}

/** Asked again before the wait after the last email was over. */
export function resendTooSoonMessage(retrySeconds: number) {
  return `Please wait ${waitPhrase(retrySeconds)} before sending another email.`;
}

/** The account has had all the confirmation emails it may get for now. */
export function tooManyConfirmationEmailsMessage(retrySeconds: number) {
  return `That's the most confirmation emails we can send for now. Try again in ${waitPhrase(retrySeconds)}.`;
}

/**
 * Whether `value` (already trimmed and lowercased) can be an account's email.
 * The login form reads anything with an @ as an email (#351), and the browser's
 * own `type="email"` check does the rest before the form is sent.
 */
export function isUsableEmail(value: string) {
  const at = value.indexOf("@");
  return at > 0 && at < value.length - 1 && value.length <= EMAIL_MAX_LENGTH && !/\s/.test(value);
}
