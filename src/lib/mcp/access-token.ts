// Access tokens for AI apps connected over MCP (#478). A token is signed, not stored: checking one
// needs no database, so an app that lists the tools each time it starts never wakes Neon. It names
// the person, the app, the grant it comes from, what it may do and the endpoint it's for (RFC 8707),
// and it lasts an hour. Tool calls still look the grant up, so disconnecting an app stops it at once.
//
// The format is ours, not a JWT: `aim_at_<payload>.<signature>`, where the payload is base64url JSON
// and the signature its HMAC-SHA256 with MCP_TOKEN_SECRET. There's no header to trust, so there's no
// algorithm to confuse, and the prefix lets secret scanners and logs recognize a leaked token.
// Sign-in (#477) mints them; tests mint their own. Only node:crypto, so tests can import it anywhere.
import { createHmac, timingSafeEqual } from "node:crypto";

export const ACCESS_TOKEN_PREFIX = "aim_at_";
/** How long an access token lasts. Apps refresh it with sign-in's refresh token (#477). */
export const ACCESS_TOKEN_SECONDS = 60 * 60;
/** The shortest MCP_TOKEN_SECRET accepted: 256 bits as base64 is 44 characters. */
export const MIN_SECRET_LENGTH = 32;
const VERSION = 1;
/** Leeway for a token stamped a moment in the future, as when several servers' clocks differ. */
const CLOCK_SKEW_SECONDS = 60;

export type AccessTokenClaims = {
  /** The person the app acts for. */
  userId: string;
  /** The McpGrant the token comes from. */
  grantId: string;
  /** The app's OAuth client ID. */
  clientId: string;
  /** What the app may do, such as ["read"]. */
  scopes: string[];
  /** The MCP endpoint's address, such as https://example.com/api/mcp. */
  resource: string;
  /** Seconds since 1970, like every OAuth timestamp. */
  issuedAt: number;
  expiresAt: number;
};

type Payload = { v: number; sub: string; gid: string; cid: string; scope: string; aud: string; iat: number; exp: number };

function sign(secret: string, payload: string) {
  return createHmac("sha256", secret).update(`${ACCESS_TOKEN_PREFIX}${payload}`).digest();
}

function nowInSeconds(now: Date) {
  return Math.floor(now.getTime() / 1000);
}

function assertSecret(secret: string) {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error(`MCP_TOKEN_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`);
}

/** A new access token for `claims`, valid for ACCESS_TOKEN_SECONDS from `now` unless `expiresAt` says otherwise. */
export function mintAccessToken(
  claims: Omit<AccessTokenClaims, "issuedAt" | "expiresAt"> & { expiresAt?: number },
  { secret, now = new Date() }: { secret: string; now?: Date },
) {
  assertSecret(secret);
  const issuedAt = nowInSeconds(now);
  const payload: Payload = {
    v: VERSION,
    sub: claims.userId,
    gid: claims.grantId,
    cid: claims.clientId,
    scope: claims.scopes.join(" "),
    aud: claims.resource,
    iat: issuedAt,
    exp: claims.expiresAt ?? issuedAt + ACCESS_TOKEN_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${ACCESS_TOKEN_PREFIX}${encoded}.${sign(secret, encoded).toString("base64url")}`;
}

export type TokenCheck =
  | { ok: true; claims: AccessTokenClaims }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "not_yet_valid" | "wrong_resource" };

const isText = (value: unknown, max = 2048): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/** Checks a token's signature, age and endpoint. Never touches the database. */
export function verifyAccessToken(token: string, { secret, resource, now = new Date() }: { secret: string; resource: string; now?: Date }): TokenCheck {
  assertSecret(secret);
  if (token.length > 8192 || !token.startsWith(ACCESS_TOKEN_PREFIX)) return { ok: false, reason: "malformed" };
  const parts = token.slice(ACCESS_TOKEN_PREFIX.length).split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [encoded, signature] = parts;

  // Compared as text: Node's base64url decoder skips characters it doesn't know, so comparing
  // decoded bytes would accept a signature with extra characters added.
  const expected = Buffer.from(sign(secret, encoded).toString("base64url"));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad_signature" };

  let payload: Partial<Payload>;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    payload.v !== VERSION ||
    !isText(payload.sub, 64) ||
    !isText(payload.gid, 64) ||
    !isText(payload.cid) ||
    typeof payload.scope !== "string" ||
    !isText(payload.aud) ||
    !isTime(payload.iat) ||
    !isTime(payload.exp)
  ) {
    return { ok: false, reason: "malformed" };
  }

  const seconds = nowInSeconds(now);
  if (payload.exp <= seconds) return { ok: false, reason: "expired" };
  if (payload.iat > seconds + CLOCK_SKEW_SECONDS) return { ok: false, reason: "not_yet_valid" };
  if (payload.aud !== resource) return { ok: false, reason: "wrong_resource" };

  return {
    ok: true,
    claims: {
      userId: payload.sub,
      grantId: payload.gid,
      clientId: payload.cid,
      scopes: payload.scope.split(" ").filter(Boolean),
      resource: payload.aud,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    },
  };
}
