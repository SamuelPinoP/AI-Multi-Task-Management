/**
 * Permanent task numbers (#486). Every task has one, app-wide, shown as AM-142: it never changes,
 * even when the task moves to another project, and is never given to another task. People, pull
 * requests, branch names and AI assistants name a task with it. Plain functions, no server code,
 * so pages, routes and the AI's tools share them.
 */

/** What comes before a task's number: AM, for AI Multi. */
export const TASK_NUMBER_PREFIX = "AM";

/** Postgres's largest integer, the highest number a task can have. */
const MAX_TASK_NUMBER = 2_147_483_647;

/** A branch name's length limit, number included. */
export const BRANCH_NAME_MAX = 50;

/** "AM-142". */
export function formatTaskNumber(number: number) {
  return `${TASK_NUMBER_PREFIX}-${number}`;
}

function validNumber(digits: string) {
  const number = Number(digits);
  return Number.isSafeInteger(number) && number >= 1 && number <= MAX_TASK_NUMBER ? number : null;
}

/**
 * AM-142 as a whole word, in any case: nothing but a space, punctuation or the start of the text
 * before it, and no letter, digit or underscore after it. So "Fixes AM-142." and the branch
 * "am-142-dark-mode" hold it, and "XAM-142" and "AM-142x" don't. The prefix is captured rather
 * than looked behind, as older Safari can't read lookbehind.
 */
const IN_TEXT = /(^|[^\p{L}\p{N}_])(am-(\d{1,10}))(?![\p{L}\p{N}_])/giu;

/** Every AM number in a text, where it is: `start` and `end` cover "AM-142". */
export function taskNumberSpans(text: string) {
  const spans: Array<{ start: number; end: number; number: number }> = [];
  for (const match of text.matchAll(IN_TEXT)) {
    const number = validNumber(match[3]);
    if (number === null) continue;
    const start = (match.index ?? 0) + match[1].length;
    spans.push({ start, end: start + match[2].length, number });
  }
  return spans;
}

/** The task numbers a text names, once each, in the order they first appear. */
export function findTaskNumbers(text: string) {
  return [...new Set(taskNumberSpans(text).map((span) => span.number))];
}

/** The number of a text that is just a task number, "AM-142" in any case, with spaces around it allowed; otherwise null. */
export function parseTaskNumber(text: string) {
  const match = /^am-(\d{1,10})$/i.exec(text.trim());
  return match ? validNumber(match[1]) : null;
}

/**
 * The task a search names by number: "AM-142", "am-142", "#142" or "142", spaces around it
 * allowed. Anything else is a search for words, so null.
 */
export function parseTaskNumberQuery(query: string) {
  const match = /^(?:am-|#)?(\d{1,10})$/i.exec(query.trim());
  return match ? validNumber(match[1]) : null;
}

/** Lowercase ASCII letters and digits, with a hyphen for each run of anything else: "Dark & light mode" is "dark-light-mode". */
function slug(text: string) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The git branch for a task: its number and its title in lowercase, at most 50 characters, such
 * as "am-142-dark-and-light-mode". A long title is cut at the last whole word that fits. Only
 * letters, digits and hyphens, so it's a valid branch name and safe to paste in a shell.
 */
export function taskBranchName(number: number, title: string) {
  const prefix = formatTaskNumber(number).toLowerCase();
  const words = slug(title);
  const branch = words ? `${prefix}-${words}` : prefix;
  if (branch.length <= BRANCH_NAME_MAX) return branch;
  // One character more than fits shows whether the cut ends a word; the hyphen after the number is always in it.
  const cut = branch.slice(0, BRANCH_NAME_MAX + 1);
  return cut.slice(0, cut.lastIndexOf("-"));
}

/** A task's short, permanent address, which /t/142 sends on to the task's page. */
export function taskNumberPath(number: number) {
  return `/t/${number}`;
}
