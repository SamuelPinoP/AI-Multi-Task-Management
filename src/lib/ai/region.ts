// Where the AI assistant may answer (#307). Gemini's free tier comes with a
// rule: "You may use only Paid Services when making API Clients available to
// users in the European Economic Area, Switzerland, or the United Kingdom"
// (Gemini API Additional Terms, checked November 15, 2026). So while AI Multi
// runs on the free tier (AI_FREE_TIER, see config.ts), people there get the
// rule-based planner instead, and nothing of theirs goes to Google. On a paid
// key, AI_FREE_TIER="false" lifts it.

/**
 * ISO 3166-1 codes, as Vercel's `x-vercel-ip-country` reports them: the 27 EU countries, the rest
 * of the EEA (Iceland, Liechtenstein, Norway), Switzerland and the United Kingdom (GB). EU regions
 * with codes of their own (Åland, French Guiana, Guadeloupe, Martinique, Mayotte, Réunion,
 * Saint Martin) are included.
 */
export const FREE_TIER_EXCLUDED_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO",
  "CH",
  // ISO and Vercel say GB; UK is here in case anything ever reports it.
  "GB", "UK",
  "AX", "GF", "GP", "MQ", "YT", "RE", "MF",
]);

/**
 * Whether the assistant may send a person's message to the model. Unknown countries (local
 * development, tests) are allowed: on Vercel every request carries the header, set by Vercel.
 */
export function regionAllowed(country: string | null | undefined, freeTier: boolean) {
  if (!freeTier) return true;
  const code = country?.trim().toUpperCase();
  return !code || !FREE_TIER_EXCLUDED_COUNTRIES.has(code);
}
