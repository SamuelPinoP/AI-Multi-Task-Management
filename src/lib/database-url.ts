/**
 * The database this deployment uses. Vercel Preview deployments have their
 * own database (PREVIEW_DATABASE_URL, from a Neon resource connected to
 * Preview only), so previews never read or write production data. Everything
 * else, including production, CI and local development, uses DATABASE_URL.
 *
 * This is the pooled address, through Neon's connection pooler, which is what
 * the app's serverless functions should use (src/lib/prisma.ts).
 *
 * Shared by the app, prisma.config.ts and the deploy scripts, so it must not
 * import server-only code.
 */
export function resolveDatabaseUrl(env: Record<string, string | undefined> = process.env) {
  const previewUrl = env.PREVIEW_DATABASE_URL?.trim();
  if (env.VERCEL_ENV === "preview" && previewUrl) return previewUrl;
  return env.DATABASE_URL?.trim() || undefined;
}

/** The address Prisma's command-line tools use, which variable it came from, and why. */
export type MigrationDatabaseUrl = {
  url: string;
  variable: string;
  /** True for the direct (unpooled) connection. */
  direct: boolean;
  /** Why the pooled address is used instead, when it is. */
  fallbackReason?: string;
};

/** Neon names a pooled host after its endpoint plus "-pooler": ep-name-123-pooler.region.aws.neon.tech. */
function withoutPoolerSuffix(host: string) {
  return host.toLowerCase().replace(/^([^.]+)-pooler(?=\.|$)/, "$1");
}

function databaseIdentity(databaseUrl: string) {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return null;
  }
  if (!/^postgres(ql)?:$/.test(url.protocol) || !url.hostname) return null;
  return [
    decodeURIComponent(url.username),
    withoutPoolerSuffix(url.hostname),
    url.port || "5432",
    decodeURIComponent(url.pathname.replace(/^\//, "")),
    url.searchParams.get("schema") || "public",
  ].join("\n");
}

/**
 * Whether two addresses reach the same database: the same user, database,
 * port and Prisma schema, and the same host once Neon's "-pooler" suffix is
 * removed. The password isn't compared.
 */
export function isSameDatabase(pooledUrl: string, directUrl: string) {
  const pooled = databaseIdentity(pooledUrl);
  return pooled !== null && pooled === databaseIdentity(directUrl);
}

/**
 * The address for Prisma's command-line tools (prisma.config.ts: migrate,
 * validate, generate, studio) (#517). `prisma migrate deploy` holds a Postgres
 * advisory lock while it runs, and a lock taken through Neon's pooler
 * (PgBouncer in transaction mode) can stay held after the run, so every later
 * migration times out with P1002. So the tools take the direct address that
 * Neon's integration sets beside the pooled one (PREVIEW_DATABASE_URL_UNPOOLED
 * or DATABASE_URL_UNPOOLED), but only when it's the same database as the
 * pooled one the app uses. Without it (local development, CI) or when it
 * points elsewhere, they use the pooled address, as before.
 */
export function resolveMigrationDatabaseUrl(env: Record<string, string | undefined> = process.env): MigrationDatabaseUrl | undefined {
  // The same choice of database as resolveDatabaseUrl: a preview with its own database never
  // looks at production's variables.
  const variable = env.VERCEL_ENV === "preview" && env.PREVIEW_DATABASE_URL?.trim() ? "PREVIEW_DATABASE_URL" : "DATABASE_URL";
  const pooled = env[variable]?.trim();
  if (!pooled) return undefined;

  const directVariable = `${variable}_UNPOOLED`;
  const direct = env[directVariable]?.trim();
  if (!direct) return { url: pooled, variable, direct: false, fallbackReason: `${directVariable} isn't set` };
  if (!isSameDatabase(pooled, direct)) {
    return { url: pooled, variable, direct: false, fallbackReason: `${directVariable} points at a different database than ${variable}` };
  }
  return { url: direct, variable: directVariable, direct: true };
}

/** For build logs: "DATABASE_URL_UNPOOLED, the direct connection" or why the pooled one is used. */
export function describeMigrationConnection(connection: MigrationDatabaseUrl) {
  return connection.direct
    ? `${connection.variable}, the direct connection`
    : `${connection.variable}, through the pooler, because ${connection.fallbackReason}`;
}
