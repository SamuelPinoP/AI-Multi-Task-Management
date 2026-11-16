// The AI assistant's settings (#307), read from environment variables so that
// moving to another model, provider or paid key is a configuration change.
// Keys are read on the server only, by the providers themselves.
import { PROVIDERS } from "@/lib/ai/providers";

type Env = Record<string, string | undefined>;

export const DEFAULT_PROVIDER = "gemini";

/**
 * Daily caps on model requests, counted by Pacific day like Gemini's free tier (see allowance.ts).
 * The free tier's pool is per Google Cloud project and shared by everyone: about 500 requests a day
 * on Gemini 3.1 Flash-Lite (#256). A message takes one request, plus one per round of tool calls.
 * - per person: about 20 questions a day;
 * - for the whole app: under the free tier, leaving room for evaluation runs (#311) on the same key.
 * Once AI Multi charges (#432), these become the plans' allowances.
 */
export const DEFAULT_USER_DAILY_REQUESTS = 40;
export const DEFAULT_APP_DAILY_REQUESTS = 400;

export type AgentCaps = { userDailyRequests: number; appDailyRequests: number };

/** Why the rule-based planner answers instead of a model, whatever the person asks. */
export type DisabledReason =
  /** The provider's API key isn't set: the normal state of a local checkout. */
  | "missing_key"
  /** AI_PROVIDER names a provider this build doesn't have. */
  | "unknown_provider"
  /** The fake provider, for tests, on a Vercel deployment. */
  | "test_provider";

export type AgentConfig = {
  provider: string;
  model: string;
  caps: AgentCaps;
  /**
   * The key is on a provider's free tier (AI_FREE_TIER, true unless "false"). Gemini's free terms
   * keep the assistant from people in the EEA, Switzerland and the UK (region.ts), and the data
   * notice says Google may use what's sent. Set "false" with the paid key at the flip (#432).
   */
  freeTier: boolean;
  disabledReason: DisabledReason | null;
};

/** A whole number from 0 up, or the default. 0 is allowed: an app cap of 0 switches the assistant off. */
function cap(value: string | undefined, fallback: number) {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return fallback;
  return Math.min(Number(trimmed), 1_000_000);
}

export function readAgentConfig(env: Env): AgentConfig {
  const provider = env.AI_PROVIDER?.trim().toLowerCase() || DEFAULT_PROVIDER;
  const spec = Object.hasOwn(PROVIDERS, provider) ? PROVIDERS[provider] : undefined;
  const caps = {
    userDailyRequests: cap(env.AI_USER_DAILY_REQUESTS, DEFAULT_USER_DAILY_REQUESTS),
    appDailyRequests: cap(env.AI_APP_DAILY_REQUESTS, DEFAULT_APP_DAILY_REQUESTS),
  };
  const model = env.AI_MODEL?.trim() || spec?.defaultModel || "";

  let disabledReason: DisabledReason | null = null;
  if (!spec) disabledReason = "unknown_provider";
  else if (spec.testOnly && env.VERCEL === "1") disabledReason = "test_provider";
  else if (spec.apiKeyEnv && !env[spec.apiKeyEnv]?.trim()) disabledReason = "missing_key";

  return { provider, model, caps, freeTier: env.AI_FREE_TIER?.trim().toLowerCase() !== "false", disabledReason };
}
