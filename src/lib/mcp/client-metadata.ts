// Client ID Metadata Documents (#477, draft-ietf-oauth-client-id-metadata-document): an app whose
// client ID is an https address, such as https://chatgpt.com/oauth/client.json, publishes its name
// and redirect URIs there, and the consent page reads them.
//
// It's the one way a visitor can make this server fetch an address of their choosing, so the fetch
// is fenced in: https on the standard port, public addresses only (checked on the address the
// connection uses, so DNS can't change in between), no redirects, at most 5 KB in 5 seconds. Answers
// are kept for an hour, or as long as the app's Cache-Control says, from 5 minutes to a day.
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { isAllowedRedirectUri, type OAuthApp } from "@/lib/mcp/oauth";

export const CLIENT_METADATA_MAX_BYTES = 5 * 1024;
export const CLIENT_METADATA_TIMEOUT_MS = 5_000;
const MINUTE_MS = 60 * 1000;
const DEFAULT_CACHE_MS = 60 * MINUTE_MS;
const MIN_CACHE_MS = 5 * MINUTE_MS;
const MAX_CACHE_MS = 24 * 60 * MINUTE_MS;
/** A failed fetch is kept a minute, so a broken app can't make every visit fetch again. */
const FAILURE_CACHE_MS = MINUTE_MS;
const MAX_CACHE_ENTRIES = 200;
const MAX_REDIRECT_URIS = 10;
const MAX_NAME_LENGTH = 80;
const USER_AGENT = "AI-Multi-OAuth/1.0";

/**
 * The address a client ID names when it's a metadata document's: https with a path, and no query,
 * fragment, user name, password, port or IP address. It must be written the way URL writes it
 * (no dot segments, lower-case host), so the ID compared is the address fetched.
 */
export function clientMetadataUrl(clientId: string): URL | null {
  if (clientId.length > 2000 || !clientId.startsWith("https://")) return null;
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return null;
  }
  if (url.href !== clientId || url.pathname === "/") return null;
  if (url.username || url.password || url.port || clientId.includes("?") || clientId.includes("#")) return null;
  const host = url.hostname;
  if (isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".") || host.endsWith(".localhost")) return null;
  return url;
}

// Everything that isn't the public internet (IANA's special-purpose registries, RFC 6890). BlockList
// checks IPv4 inside IPv6 (::ffff:10.0.0.1) against the IPv4 ranges.
const NOT_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  // Unspecified, loopback and the old IPv4-compatible addresses.
  ["::", 96],
  // NAT64 and 6to4 carry an IPv4 address that could be a private one.
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, "ipv6");
}

/** Whether an IP address is on the public internet: not loopback, private, link-local, shared, reserved or for documentation. */
export function isPublicAddress(address: string) {
  const family = isIP(address);
  return family !== 0 && !NOT_PUBLIC.check(address, family === 4 ? "ipv4" : "ipv6");
}

type ErrorWithCode = Error & { code?: string };
const failure = (code: string, message: string): ErrorWithCode => Object.assign(new Error(message), { code });

/**
 * A DNS lookup for the connection that only hands it public addresses. If any answer is private,
 * it refuses them all: a name that points inside a network isn't an app's public document.
 */
export function publicOnlyLookup(resolve: typeof dnsLookup = dnsLookup): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { all: true }, (error, addresses: LookupAddress[]) => {
      if (error) return callback(error, "", 0);
      if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
        return callback(failure("ENOTPUBLIC", `${hostname} isn't on the public internet.`), "", 0);
      }
      const family = options.family === 4 || options.family === 6 ? options.family : 0;
      const usable = family ? addresses.filter((entry) => entry.family === family) : addresses;
      if (!usable.length) return callback(failure("ENOTFOUND", `${hostname} has no address of that family.`), "", 0);
      if (options.all) return callback(null, usable);
      callback(null, usable[0].address, usable[0].family);
    });
  };
}

/** Reads a body, giving up as soon as it passes `maxBytes`. */
export function readLimited(stream: NodeJS.ReadableStream & { destroy?: (error?: Error) => void }, maxBytes: number) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on("data", (chunk: Buffer | string) => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += bytes.length;
      if (size > maxBytes) {
        reject(failure("ETOOLARGE", `The document is over ${maxBytes} bytes.`));
        stream.destroy?.();
        return;
      }
      chunks.push(bytes);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

export type FetchedDocument = { status: number; contentType: string | null; cacheControl: string | null; body: string };
/** Fetches one document. Swapped out in tests; the real one is httpsTransport. */
export type DocumentTransport = (url: URL) => Promise<FetchedDocument>;

const firstHeader = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

/** GET over https through the public-only lookup, with the size and time limits. Redirects aren't followed. */
export function httpsTransport({
  lookup = publicOnlyLookup(),
  timeoutMs = CLIENT_METADATA_TIMEOUT_MS,
  maxBytes = CLIENT_METADATA_MAX_BYTES,
}: { lookup?: LookupFunction; timeoutMs?: number; maxBytes?: number } = {}): DocumentTransport {
  return (url) =>
    new Promise((resolve, reject) => {
      if (url.protocol !== "https:") return reject(failure("ENOTHTTPS", "Only https documents are fetched."));
      const request = httpsRequest(
        url,
        { method: "GET", lookup, signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json", "user-agent": USER_AGENT } },
        (response) => {
          if (Number(response.headers["content-length"]) > maxBytes) {
            reject(failure("ETOOLARGE", `The document is over ${maxBytes} bytes.`));
            request.destroy();
            return;
          }
          readLimited(response, maxBytes).then(
            (body) =>
              resolve({
                status: response.statusCode ?? 0,
                contentType: firstHeader(response.headers["content-type"]),
                cacheControl: firstHeader(response.headers["cache-control"]),
                body,
              }),
            reject,
          );
        },
      );
      request.on("error", reject);
      request.end();
    });
}

export type ClientMetadataProblem = "not_metadata_url" | "not_public" | "unreachable" | "timeout" | "too_large" | "bad_status" | "not_json" | "invalid";
export type ClientMetadataResult = { ok: true; app: OAuthApp } | { ok: false; problem: ClientMetadataProblem; detail: string };

const invalid = (detail: string): ClientMetadataResult => ({ ok: false, problem: "invalid", detail });

/** Characters that could disguise a name: controls, zero-width ones and those that change the text's direction. */
const HIDDEN_CHARACTERS = /[\u0000-\u001f\u007f-\u009f­؜​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** An app's name as the consent page shows it, or null when nothing readable is left. */
export function cleanAppName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.replace(HIDDEN_CHARACTERS, "").replace(/\s+/g, " ").trim();
  return name ? Array.from(name).slice(0, MAX_NAME_LENGTH).join("").trim() : null;
}

/** Ways to sign in with a shared secret, which a public document can't keep (CIMD, section 4.1). */
const SECRET_METHODS = new Set(["client_secret_post", "client_secret_basic", "client_secret_jwt"]);

/**
 * Checks a fetched document: its client_id must be its own address, its redirect URIs allowed, and
 * it can't use a shared secret. An app that signs its token requests with a key (private_key_jwt)
 * signs in here as a public app: AI Multi doesn't take keys, and PKCE protects its code.
 */
export function parseClientMetadata(clientId: string, document: unknown): ClientMetadataResult {
  if (!document || typeof document !== "object" || Array.isArray(document)) return invalid("The document isn't a JSON object.");
  const fields = document as Record<string, unknown>;
  if (fields.client_id !== clientId) return invalid("client_id isn't the document's own address.");

  const redirectUris = fields.redirect_uris;
  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length === 0 ||
    redirectUris.length > MAX_REDIRECT_URIS ||
    !redirectUris.every((uri) => typeof uri === "string" && isAllowedRedirectUri(uri))
  ) {
    return invalid("redirect_uris must list 1 to 10 https, loopback or app addresses.");
  }
  if ("client_secret" in fields || "client_secret_expires_at" in fields) return invalid("A metadata document can't hold a client secret.");

  const method = fields.token_endpoint_auth_method ?? "none";
  const methods = Array.isArray(fields.token_endpoint_auth_methods_supported) ? fields.token_endpoint_auth_methods_supported : [];
  if (typeof method !== "string" || SECRET_METHODS.has(method) || (method !== "none" && method !== "private_key_jwt" && !methods.includes("none"))) {
    return invalid("token_endpoint_auth_method must be none or private_key_jwt.");
  }
  const grantTypes = fields.grant_types;
  if (grantTypes !== undefined && !(Array.isArray(grantTypes) && grantTypes.includes("authorization_code"))) {
    return invalid("grant_types must include authorization_code.");
  }
  const responseTypes = fields.response_types;
  if (responseTypes !== undefined && !(Array.isArray(responseTypes) && responseTypes.includes("code"))) {
    return invalid("response_types must include code.");
  }

  return {
    ok: true,
    app: { id: clientId, name: cleanAppName(fields.client_name) ?? new URL(clientId).hostname, redirectUris: redirectUris as string[] },
  };
}

const isJson = (contentType: string | null) => Boolean(contentType && /^application\/([\w.+-]+\+)?json\s*(;|$)/i.test(contentType));

/** How long to keep a document: its Cache-Control max-age, between 5 minutes and a day; an hour without one. */
export function cacheMilliseconds(cacheControl: string | null) {
  if (!cacheControl) return DEFAULT_CACHE_MS;
  if (/\b(no-store|no-cache)\b/i.test(cacheControl)) return MIN_CACHE_MS;
  const maxAge = /\bmax-age=(\d+)/i.exec(cacheControl);
  if (!maxAge) return DEFAULT_CACHE_MS;
  return Math.min(Math.max(Number(maxAge[1]) * 1000, MIN_CACHE_MS), MAX_CACHE_MS);
}

function problemFor(error: unknown): ClientMetadataProblem {
  const { code, name } = (error ?? {}) as ErrorWithCode;
  if (code === "ENOTPUBLIC") return "not_public";
  if (code === "ETOOLARGE") return "too_large";
  if (name === "AbortError" || name === "TimeoutError" || code === "ABORT_ERR" || code === "ETIMEDOUT") return "timeout";
  return "unreachable";
}

async function fetchDocument(transport: DocumentTransport, url: URL, clientId: string): Promise<{ result: ClientMetadataResult; keepMs: number }> {
  let document: FetchedDocument;
  try {
    document = await transport(url);
  } catch (error) {
    const problem = problemFor(error);
    return { result: { ok: false, problem, detail: error instanceof Error ? error.message : problem }, keepMs: FAILURE_CACHE_MS };
  }
  const fail = (problem: ClientMetadataProblem, detail: string) => ({ result: { ok: false as const, problem, detail }, keepMs: FAILURE_CACHE_MS });
  // A redirect counts as a failure: the document must be at the client ID itself.
  if (document.status !== 200) return fail("bad_status", `The document answered ${document.status}.`);
  if (!isJson(document.contentType)) return fail("not_json", "The document isn't served as JSON.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(document.body);
  } catch {
    return fail("not_json", "The document isn't valid JSON.");
  }
  const result = parseClientMetadata(clientId, parsed);
  return { result, keepMs: result.ok ? cacheMilliseconds(document.cacheControl) : FAILURE_CACHE_MS };
}

export type ClientMetadataResolver = (clientId: string) => Promise<ClientMetadataResult>;

/**
 * Reads apps' documents, kept in memory per server. Requests for the same document while one fetch
 * is under way share it.
 */
export function createClientMetadataResolver({
  transport = httpsTransport(),
  now = () => Date.now(),
}: { transport?: DocumentTransport; now?: () => number } = {}): ClientMetadataResolver {
  const cache = new Map<string, { expiresAt: number; result: ClientMetadataResult }>();
  const inFlight = new Map<string, Promise<ClientMetadataResult>>();

  return async (clientId) => {
    const url = clientMetadataUrl(clientId);
    if (!url) return { ok: false, problem: "not_metadata_url", detail: "The client ID isn't an https address AI Multi can fetch." };

    const cached = cache.get(clientId);
    if (cached && cached.expiresAt > now()) return cached.result;
    cache.delete(clientId);
    const pending = inFlight.get(clientId);
    if (pending) return pending;

    const fetching = fetchDocument(transport, url, clientId)
      .then(({ result, keepMs }) => {
        if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
        cache.set(clientId, { expiresAt: now() + keepMs, result });
        return result;
      })
      .finally(() => inFlight.delete(clientId));
    inFlight.set(clientId, fetching);
    return fetching;
  };
}
