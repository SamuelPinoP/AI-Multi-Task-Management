// How much one request to the AI assistant may carry (#307), and how much of
// its chat history is kept (#452). On their own, with no imports, so the chat in
// the browser (#308) keeps to the same limits as the endpoint without bundling
// the agent.

export const MAX_MESSAGE_CHARS = 4000;
/** Messages one chat can hold (#452): 20 questions and their answers. After that, the person starts a new chat. */
export const MAX_MESSAGES = 40;
/** How many of the latest messages the model sees. Older ones stay here: less data sent, fewer tokens. */
export const MODEL_HISTORY = 12;
/** Chats each person keeps (#452). Saving another deletes the one whose latest message is oldest. */
export const MAX_CHATS = 20;
/** The longest name a chat can be given when it's renamed. */
export const MAX_CHAT_TITLE_CHARS = 100;
