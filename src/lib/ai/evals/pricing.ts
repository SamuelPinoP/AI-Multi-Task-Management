// List prices and free-plan limits of the models the evaluations compare
// (#311), to cost a run and to pace it under a free plan. Prices change: each
// entry says when it was checked and where, and a run's results keep the
// figures it used.
export type ModelPrice = {
  /** US dollars per million input tokens, at the short-prompt rate where there are two. */
  inputPerMillion: number;
  outputPerMillion: number;
};

export type FreePlan = {
  requestsPerMinute?: number;
  requestsPerDay?: number;
  tokensPerMinute?: number;
  tokensPerDay?: number;
};

export type ModelInfo = {
  provider: string;
  model: string;
  price: ModelPrice | null;
  /** Null when the provider has no free plan for it, or its limits weren't published. */
  freePlan: FreePlan | null;
  /** How fast a run may go: the free plan's limits, or the paid plan's lowest tier. */
  pace: { requestsPerMinute?: number; tokensPerMinute?: number };
  checked: string;
  sources: string[];
};

export const MODELS: ModelInfo[] = [
  {
    provider: "gemini",
    model: "gemini-3.1-flash-lite",
    price: { inputPerMillion: 0.25, outputPerMillion: 1.5 },
    freePlan: { requestsPerMinute: 15, requestsPerDay: 500 },
    pace: { requestsPerMinute: 15 },
    checked: "2026-11-19",
    sources: ["https://ai.google.dev/gemini-api/docs/pricing", "https://ai.google.dev/gemini-api/docs/rate-limits"],
  },
  {
    provider: "gemini",
    model: "gemini-3.5-flash-lite",
    price: { inputPerMillion: 0.3, outputPerMillion: 2.5 },
    freePlan: null,
    pace: { requestsPerMinute: 10 },
    checked: "2026-11-19",
    sources: ["https://ai.google.dev/gemini-api/docs/pricing"],
  },
  {
    provider: "anthropic",
    model: "claude-haiku-5-5",
    // $0.50 / $2.50 above 100K input tokens; the assistant's prompts are far shorter.
    price: { inputPerMillion: 0.1, outputPerMillion: 0.5 },
    freePlan: null,
    pace: { requestsPerMinute: 50 },
    checked: "2026-11-19",
    sources: ["https://platform.claude.com/docs/en/about-claude/pricing"],
  },
  {
    provider: "groq",
    model: "openai/gpt-oss-120b",
    price: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
    freePlan: { requestsPerMinute: 30, requestsPerDay: 1_000, tokensPerMinute: 8_000, tokensPerDay: 200_000 },
    pace: { requestsPerMinute: 30, tokensPerMinute: 8_000 },
    checked: "2026-11-19",
    sources: ["https://groq.com/pricing", "https://console.groq.com/docs/rate-limits"],
  },
];

/** Pace for a model this file doesn't list: slow enough for any free plan. */
export const UNKNOWN_PACE = { requestsPerMinute: 10 };

export function modelInfo(provider: string, model: string) {
  return MODELS.find((entry) => entry.provider === provider && entry.model === model) ?? null;
}

/** What tokens cost at list prices, in US dollars; null without a price. */
export function costUsd(tokens: { inputTokens: number; outputTokens: number }, price: ModelPrice | null) {
  if (!price) return null;
  return (tokens.inputTokens * price.inputPerMillion + tokens.outputTokens * price.outputPerMillion) / 1_000_000;
}
