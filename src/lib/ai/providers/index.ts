// The model providers AI Multi can use, by the name AI_PROVIDER takes (#307).
// This folder is the only place that knows them: adding one (Anthropic, or an
// OpenAI-compatible API such as Groq, #311) is a new file here and a line below.
import type { AgentConfig } from "@/lib/ai/config";
import { createFakeProvider } from "@/lib/ai/providers/fake";
import { createGeminiProvider, GEMINI_DEFAULT_MODEL } from "@/lib/ai/providers/gemini";
import type { Provider } from "@/lib/ai/types";

type Env = Record<string, string | undefined>;

export type ProviderSpec = {
  defaultModel: string;
  /** The env var holding its API key; read on the server only. */
  apiKeyEnv?: string;
  /** For tests: refused on Vercel deployments. */
  testOnly?: boolean;
  create(env: Env): Provider;
};

export const PROVIDERS: Record<string, ProviderSpec> = {
  gemini: {
    defaultModel: GEMINI_DEFAULT_MODEL,
    apiKeyEnv: "GEMINI_API_KEY",
    create: (env) => createGeminiProvider({ apiKey: env.GEMINI_API_KEY?.trim() ?? "" }),
  },
  fake: { defaultModel: "fake", testOnly: true, create: () => createFakeProvider() },
};

/** The configured provider, or null when the assistant is off (see `AgentConfig.disabledReason`). */
export function createProvider(config: AgentConfig, env: Env): Provider | null {
  if (config.disabledReason || !Object.hasOwn(PROVIDERS, config.provider)) return null;
  return PROVIDERS[config.provider].create(env);
}
