// Kept free of server-only imports: the /login page and the log-in pop-up (#543) share these,
// and they can be unit tested with plain Node.
import { tooManyAttemptsMessage } from "@/lib/rate-limit-core";

/**
 * Why /api/auth/login turned an attempt down: in the /login page's address after its redirect, or
 * in the JSON answer the log-in pop-up asks for. Only the pop-up hears "unconfirmed" (the right
 * password, an email not confirmed yet); the page goes on to "Check your email" instead.
 */
export type LoginFailure = "missing" | "invalid" | "rate-limited" | "unconfirmed";

/** What the log-in form says about a failed attempt, or null when `error` names none. */
export function loginFailureMessage(error: string | undefined, retrySeconds?: number | string) {
  if (error === "rate-limited") return tooManyAttemptsMessage("sign-in attempts", Number(retrySeconds) || 60);
  if (error === "missing") return "Enter your email or username, and your password.";
  // One message whichever part was wrong, so it doesn't tell anyone which accounts exist.
  if (error === "invalid") return "Incorrect email, username or password.";
  if (error === "unconfirmed") return "Your email isn't confirmed yet. Open the link we sent you.";
  return null;
}

// Pages of one thing the guest made: a project and its board and chat, a task, a tree page.
const ITEM_PAGE = /^\/(projects|tasks|tree)\/([^/]+)/;

/**
 * Where logging in from a guest workspace lands (#543): the same page, now in the account. What the
 * guest made stays behind in the guest workspace, so on a page of one of its projects, tasks or tree
 * pages the account lands on that list instead of a page it can't open.
 */
export function pageAfterGuestLogin(pathname: string) {
  const item = ITEM_PAGE.exec(pathname);
  // The Tasks board is a view of every task, not one task's page.
  if (!item || (item[1] === "tasks" && item[2] === "board")) return pathname;
  return `/${item[1]}`;
}
