// Send feedback (#430): what the form may send. Kept free of server-only imports so it can be unit
// tested with plain Node.

/** The longest message the form takes, in characters. */
export const FEEDBACK_MAX_LENGTH = 2000;

export const EMPTY_FEEDBACK_MESSAGE = "Write your feedback first.";
export const LONG_FEEDBACK_MESSAGE = `Keep it under ${FEEDBACK_MAX_LENGTH.toLocaleString("en-US")} characters.`;

export type Feedback = {
  message: string;
  /** Whether the owner may email them about it ("Samuel can email me about this"). */
  mayReply: boolean;
};

/** The request body as feedback, or the reason it can't be sent. Only a literal `true` allows a reply. */
export function parseFeedback(body: unknown): Feedback | { error: string } {
  if (!body || typeof body !== "object") return { error: EMPTY_FEEDBACK_MESSAGE };
  const { message, mayReply } = body as Record<string, unknown>;
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return { error: EMPTY_FEEDBACK_MESSAGE };
  if (text.length > FEEDBACK_MAX_LENGTH) return { error: LONG_FEEDBACK_MESSAGE };
  return { message: text, mayReply: mayReply === true };
}
