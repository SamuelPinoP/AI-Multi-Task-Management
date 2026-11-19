// The model providers AI Multi can use, by the name AI_PROVIDER takes (#307).
// This folder is the only place that knows them: adding one is a new file here
// and a line below. Anthropic and Groq (#311) are compared with Gemini by the
// evaluations in src/lib/ai/evals before launch; until the data notice and the
// Privacy Policy name them, deployments refuse them.
import type { AgentConfig } from "@/lib/ai/config";
import { ANTHROPIC_DEFAULT_MODEL, createAnthropicProvider } from "@/lib/ai/providers/anthropic";
import { createFakeProvider } from "@/lib/ai/providers/fake";
import { createGeminiProvider, GEMINI_DEFAULT_MODEL } from "@/lib/ai/providers/gemini";
import { createOpenAiCompatibleProvider, GROQ_BASE_URL, GROQ_DEFAULT_MODEL } from "@/lib/ai/providers/openai-compatible";
import type { Provider } from "@/lib/ai/types";

type Env = Record<string, string | undefined>;

export type ProviderSpec = {
  defaultModel: string;
  /** The env var holding its API key; read on the server only. */
  apiKeyEnv?: string;
  /** For tests: refused on Vercel deployments. */
  testOnly?: boolean;
  /**
   * For evaluations and local runs: refused on Vercel deployments until the data notice and the
   * Privacy Policy name the provider, since the person's data would go to it.
   */
  evaluationOnly?: boolean;
  create(env: Env): Provider;
};

export const PROVIDERS: Record<string, ProviderSpec> = {
  gemini: {
    defaultModel: GEMINI_DEFAULT_MODEL,
    apiKeyEnv: "GEMINI_API_KEY",
    create: (env) => createGeminiProvider({ apiKey: env.GEMINI_API_KEY?.trim() ?? "" }),
  },
  anthropic: {
    defaultModel: ANTHROPIC_DEFAULT_MODEL,
    // Not ANTHROPIC_API_KEY: Claude Code reads that one, and would bill a terminal that has it set.
    apiKeyEnv: "CLAUDE_API_KEY",
    evaluationOnly: true,
    create: (env) => createAnthropicProvider({ apiKey: env.CLAUDE_API_KEY?.trim() ?? "" }),
  },
  groq: {
    defaultModel: GROQ_DEFAULT_MODEL,
    apiKeyEnv: "GROQ_API_KEY",
    evaluationOnly: true,
    create: (env) => createOpenAiCompatibleProvider({ name: "groq", baseUrl: GROQ_BASE_URL, apiKey: env.GROQ_API_KEY?.trim() ?? "" }),
  },
  fake: { defaultModel: "fake", testOnly: true, create: () => createFakeProvider() },
};

/** The configured provider, or null when the assistant is off (see `AgentConfig.disabledReason`). */
export function createProvider(config: AgentConfig, env: Env): Provider | null {
  if (config.disabledReason || !Object.hasOwn(PROVIDERS, config.provider)) return null;
  return PROVIDERS[config.provider].create(env);
}
