// The AI assistant's data notice (#307, #308): before anything of theirs is
// sent to a model provider, a person agrees to a notice saying what is sent, to
// whom and how it may be used. On Gemini's free tier, Google may use what is
// sent to improve its products and human reviewers may read it (#256).
// No server-only imports: the chat panel shows the same version it sends back.

/**
 * The current notice, by the day it last changed. Agreements from before it no longer count, so
 * changing it asks everyone again. Change it whenever the notice changes what is sent, to whom, or
 * how the provider may use it (for example, at the move to a paid tier, #432).
 */
export const AI_NOTICE_VERSION = "2026-11-16";

const NOTICE_UPDATED = new Date(`${AI_NOTICE_VERSION}T00:00:00.000Z`);

export function hasAcceptedNotice(acceptedAt: Date | null | undefined, noticeUpdated = NOTICE_UPDATED) {
  return acceptedAt instanceof Date && acceptedAt.getTime() >= noticeUpdated.getTime();
}

export const NOTICE_REQUIRED_MESSAGE = "Before you use the AI assistant, read and agree to what it sends and to whom.";

/** An agreement names the notice version the person was shown; an older page gets an error, not a record. */
export function parseNoticeAgreement(body: unknown): { ok: true } | { error: string } {
  const version = typeof body === "object" && body !== null ? (body as { version?: unknown }).version : undefined;
  return version === AI_NOTICE_VERSION ? { ok: true } : { error: "The notice has changed since this page loaded. Reload and read it again." };
}
