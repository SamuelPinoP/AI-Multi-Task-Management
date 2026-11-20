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

/**
 * The database Prisma's CLI migrates (prisma.config.ts): the same one as resolveDatabaseUrl, over a
 * direct connection (#515). `prisma migrate deploy` takes a session-level advisory lock and never
 * unlocks it, so the lock ends only when the session does. Neon's Vercel resources set the pooled
 * URL, and through the pooler the session outlived the build: the next deploy within about six
 * minutes waited 10 seconds for the lock and failed. The app keeps the pooled URL.
 */
export function resolveMigrationDatabaseUrl(env: Record<string, string | undefined> = process.env) {
  const databaseUrl = resolveDatabaseUrl(env);
  return databaseUrl && directDatabaseUrl(databaseUrl);
}

/** Neon (and Vercel Postgres, built on it) names a pooled host after its endpoint plus "-pooler". */
const POOLED_HOST = /^([a-z0-9-]+)-pooler(\.[a-z0-9.-]+\.(?:neon\.tech|vercel-storage\.com))$/i;

/**
 * The URL with Neon's pooled host swapped for the direct one, which is the same host without
 * "-pooler". Only the host changes, so the credentials and options stay exactly as configured.
 * Any other URL, including one that can't be read, comes back unchanged.
 */
export function directDatabaseUrl(databaseUrl: string) {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return databaseUrl;
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) return databaseUrl;
  const match = POOLED_HOST.exec(url.hostname);
  if (!match) return databaseUrl;
  const pooledHost = url.hostname.replace(/[.-]/g, "\\$&");
  return databaseUrl.replace(new RegExp(`(@|//)${pooledHost}(?=[:/?#]|$)`, "i"), `$1${match[1]}${match[2]}`);
}
