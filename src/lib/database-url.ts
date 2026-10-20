/**
 * The database this deployment uses. Vercel Preview deployments have their
 * own database (PREVIEW_DATABASE_URL, from a Neon resource connected to
 * Preview only), so previews never read or write production data. Everything
 * else, including production, CI and local development, uses DATABASE_URL.
 *
 * Shared by the app and prisma.config.ts, so it must not import server-only code.
 */
export function resolveDatabaseUrl(env: Record<string, string | undefined> = process.env) {
  const previewUrl = env.PREVIEW_DATABASE_URL?.trim();
  if (env.VERCEL_ENV === "preview" && previewUrl) return previewUrl;
  return env.DATABASE_URL?.trim() || undefined;
}
