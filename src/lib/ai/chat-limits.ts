// How much one request to the AI assistant may carry (#307). On their own, with
// no imports, so the chat in the browser (#308) keeps to the same limits as the
// endpoint without bundling the agent.

export const MAX_MESSAGE_CHARS = 4000;
/** Messages one request may carry: the chat keeps the conversation while it's open (#308). */
export const MAX_MESSAGES = 40;
/** How many of the latest messages the model sees. Older ones stay here: less data sent, fewer tokens. */
export const MODEL_HISTORY = 12;
