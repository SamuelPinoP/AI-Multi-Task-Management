// Client ID Metadata Documents (#477): which addresses are fetched, the fence around the fetch (public
// addresses only, size and time limits), what a document must say, and how answers are kept.
import assert from "node:assert/strict";
import type { LookupAddress } from "node:dns";
import { createServer, type LookupFunction, type Socket } from "node:net";
import { Readable } from "node:stream";
import test from "node:test";
import {
  cacheMilliseconds,
  cleanAppName,
  clientMetadataUrl,
  createClientMetadataResolver,
  httpsTransport,
  isPublicAddress,
  parseClientMetadata,
  publicOnlyLookup,
  readLimited,
  type FetchedDocument,
} from "./client-metadata";

const CLIENT_ID = "https://chatgpt.com/oauth/e2e-callback/client.json";
// Shaped like ChatGPT's document: it prefers private_key_jwt and also lists none.
const DOCUMENT = {
  client_id: CLIENT_ID,
  client_name: "ChatGPT",
  redirect_uris: ["https://chatgpt.com/connector/oauth/e2e-callback"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "private_key_jwt",
  token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
  jwks_uri: "https://chatgpt.com/oauth/jwks.json",
};
const MINUTE = 60 * 1000;

test("a client ID is fetched only when it's a plain https address with a path", () => {
  assert.equal(clientMetadataUrl(CLIENT_ID)?.href, CLIENT_ID);
  assert.ok(clientMetadataUrl("https://claude.ai/oauth/claude-code-client-metadata"));
  for (const clientId of [
    "aim_ci_abc",
    "http://app.example/client.json",
    "https://app.example",
    "https://app.example/",
    "https://APP.example/client.json",
    "https://app.example/a/../client.json",
    "https://app.example:443/client.json",
    "https://app.example:8443/client.json",
    "https://user@app.example/client.json",
    "https://app.example/client.json?version=2",
    "https://app.example/client.json#top",
    "https://127.0.0.1/client.json",
    "https://[::1]/client.json",
    "https://0x7f000001/client.json",
    "https://localhost/client.json",
    "https://metadata/client.json",
    "https://app.localhost/client.json",
    `https://app.example/${"a".repeat(2000)}`,
  ]) {
    assert.equal(clientMetadataUrl(clientId), null, clientId);
  }
});

test("only public internet addresses count as public", () => {
  for (const address of ["93.184.216.34", "8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e", "::ffff:8.8.8.8"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "127.255.255.254",
    // Cloud metadata services live here.
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.8",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "64:ff9b::a00:1",
    "2001:db8::1",
    "2002:a00:1::1",
    "fc00::1",
    "fd12:3456:789a::1",
    "fe80::1",
    "ff02::1",
    "not an address",
    "",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

/** A DNS answer as dns.lookup gives it with `all: true`. */
function fakeDns(answer: LookupAddress[] | NodeJS.ErrnoException) {
  return ((_hostname: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => {
    if (answer instanceof Error) callback(answer, []);
    else callback(null, answer);
  }) as unknown as typeof import("node:dns").lookup;
}

function lookupWith(lookup: LookupFunction, options: { family?: number; all?: boolean } = {}) {
  return new Promise<{ error: (Error & { code?: string }) | null; result: unknown }>((resolve) => {
    lookup("app.example", options as Parameters<LookupFunction>[1], (error, address, family) => {
      resolve({ error, result: options.all ? address : { address, family } });
    });
  });
}

test("the fetch's DNS lookup refuses a name with any address that isn't public", async () => {
  const both = [
    { address: "93.184.216.34", family: 4 },
    { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
  ];
  assert.deepEqual(await lookupWith(publicOnlyLookup(fakeDns(both))), { error: null, result: { address: "93.184.216.34", family: 4 } });
  assert.deepEqual(await lookupWith(publicOnlyLookup(fakeDns(both)), { all: true }), { error: null, result: both });
  assert.deepEqual(await lookupWith(publicOnlyLookup(fakeDns(both)), { family: 6 }), { error: null, result: { address: both[1].address, family: 6 } });

  // One private answer among public ones, as a rebinding attack would give, refuses them all.
  for (const answer of [
    [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }],
    [{ address: "::ffff:127.0.0.1", family: 6 }],
    [{ address: "169.254.169.254", family: 4 }],
    [],
  ]) {
    const { error } = await lookupWith(publicOnlyLookup(fakeDns(answer)));
    assert.equal(error?.code, "ENOTPUBLIC", JSON.stringify(answer));
  }
  const { error: noV6 } = await lookupWith(publicOnlyLookup(fakeDns([{ address: "93.184.216.34", family: 4 }])), { family: 6 });
  assert.equal(noV6?.code, "ENOTFOUND");
  const { error: dnsError } = await lookupWith(publicOnlyLookup(fakeDns(Object.assign(new Error("not found"), { code: "ENOTFOUND" }))));
  assert.equal(dnsError?.code, "ENOTFOUND");
});

test("a body is read up to the limit, and no further", async () => {
  assert.equal(await readLimited(Readable.from([Buffer.from("{\"a\":"), Buffer.from("1}")]), 10), "{\"a\":1}");
  await assert.rejects(readLimited(Readable.from([Buffer.alloc(6), Buffer.alloc(6)]), 10), { code: "ETOOLARGE" });
});

test("the real fetch refuses anything but https, and names that point inside a network", async () => {
  await assert.rejects(httpsTransport()(new URL("http://app.example/client.json")), { code: "ENOTHTTPS" });
  // localhost resolves to loopback addresses, so the connection is never made.
  await assert.rejects(httpsTransport()(new URL("https://localhost:9/client.json")), { code: "ENOTPUBLIC" });
});

test("the real fetch gives up after its time limit", async () => {
  // A server that accepts the connection and never answers the TLS handshake.
  const sockets: Socket[] = [];
  const server = createServer((socket) => sockets.push(socket));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  const toLoopback: LookupFunction = (_hostname, options, callback) =>
    callback(null, options.all ? [{ address: "127.0.0.1", family: 4 }] : "127.0.0.1", 4);
  try {
    const started = Date.now();
    await assert.rejects(httpsTransport({ lookup: toLoopback, timeoutMs: 200 })(new URL(`https://app.example:${port}/client.json`)), (error: Error) =>
      ["AbortError", "TimeoutError"].includes(error.name),
    );
    assert.ok(Date.now() - started < 5000);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a document is accepted when it names itself, registers safe addresses and keeps no secret", () => {
  assert.deepEqual(parseClientMetadata(CLIENT_ID, DOCUMENT), {
    ok: true,
    app: { id: CLIENT_ID, name: "ChatGPT", redirectUris: DOCUMENT.redirect_uris },
  });
  // Without a name, the consent page shows the document's host.
  const unnamed = parseClientMetadata(CLIENT_ID, { client_id: CLIENT_ID, redirect_uris: ["http://127.0.0.1/callback"] });
  assert.ok(unnamed.ok);
  assert.equal(unnamed.app.name, "chatgpt.com");
  assert.ok(parseClientMetadata(CLIENT_ID, { ...DOCUMENT, token_endpoint_auth_method: "none", token_endpoint_auth_methods_supported: undefined }).ok);
  assert.ok(parseClientMetadata(CLIENT_ID, { ...DOCUMENT, token_endpoint_auth_method: "tls_client_auth" }).ok, "none is among its methods");

  for (const [why, document] of [
    ["not an object", ["https://chatgpt.com"]],
    ["not an object", "client"],
    ["another client_id", { ...DOCUMENT, client_id: "https://chatgpt.com/oauth/other/client.json" }],
    ["no redirect_uris", { ...DOCUMENT, redirect_uris: undefined }],
    ["empty redirect_uris", { ...DOCUMENT, redirect_uris: [] }],
    ["a script address", { ...DOCUMENT, redirect_uris: ["javascript:alert(1)"] }],
    ["plain http", { ...DOCUMENT, redirect_uris: ["http://chatgpt.com/callback"] }],
    ["not a string", { ...DOCUMENT, redirect_uris: [42] }],
    ["too many", { ...DOCUMENT, redirect_uris: Array.from({ length: 11 }, (_, index) => `https://chatgpt.com/cb/${index}`) }],
    ["a secret", { ...DOCUMENT, client_secret: "shh" }],
    ["a secret method", { ...DOCUMENT, token_endpoint_auth_method: "client_secret_basic" }],
    ["an unknown method", { ...DOCUMENT, token_endpoint_auth_method: "tls_client_auth", token_endpoint_auth_methods_supported: ["tls_client_auth"] }],
    ["no code grant", { ...DOCUMENT, grant_types: ["client_credentials"] }],
    ["no code response", { ...DOCUMENT, response_types: ["token"] }],
  ] as const) {
    const result = parseClientMetadata(CLIENT_ID, document);
    assert.equal(result.ok, false, why);
    assert.equal(!result.ok && result.problem, "invalid", why);
  }
});

test("an app's name loses characters that could disguise it", () => {
  assert.equal(cleanAppName("  Claude \n Code  "), "Claude Code");
  assert.equal(cleanAppName("Cla​ude"), "Claude");
  // A right-to-left override could make "Evil‮ppA" read as another name.
  assert.equal(cleanAppName("Evil‮ppA"), "EvilppA");
  assert.equal(cleanAppName("a".repeat(100))?.length, 80);
  assert.equal(cleanAppName("​⁦"), null);
  assert.equal(cleanAppName(""), null);
  assert.equal(cleanAppName(42), null);
});

test("a document is kept for an hour, or its max-age between 5 minutes and a day", () => {
  assert.equal(cacheMilliseconds(null), 60 * MINUTE);
  assert.equal(cacheMilliseconds("public"), 60 * MINUTE);
  assert.equal(cacheMilliseconds("max-age=60"), 5 * MINUTE);
  assert.equal(cacheMilliseconds("public, max-age=7200"), 120 * MINUTE);
  assert.equal(cacheMilliseconds("max-age=999999"), 24 * 60 * MINUTE);
  assert.equal(cacheMilliseconds("no-store"), 5 * MINUTE);
});

/** A resolver whose fetches answer from `answers` in turn, on a clock the test moves. */
function resolverWith(...answers: Array<Partial<FetchedDocument> | Error>) {
  let clock = Date.parse("2026-11-25T12:00:00.000Z");
  const fetched: string[] = [];
  const resolve = createClientMetadataResolver({
    now: () => clock,
    transport: async (url) => {
      fetched.push(url.href);
      const answer = answers[Math.min(fetched.length - 1, answers.length - 1)];
      if (answer instanceof Error) throw answer;
      return { status: 200, contentType: "application/json", cacheControl: null, body: JSON.stringify(DOCUMENT), ...answer };
    },
  });
  return { resolve, fetched, advance: (ms: number) => (clock += ms) };
}

test("the resolver fetches a document once, and again when it's due", async () => {
  const { resolve, fetched, advance } = resolverWith({ cacheControl: "max-age=600" });
  const first = await resolve(CLIENT_ID);
  assert.ok(first.ok);
  assert.equal(first.app.name, "ChatGPT");
  assert.deepEqual(await resolve(CLIENT_ID), first);
  assert.equal(fetched.length, 1);
  advance(10 * MINUTE - 1);
  await resolve(CLIENT_ID);
  assert.equal(fetched.length, 1);
  advance(1);
  await resolve(CLIENT_ID);
  assert.equal(fetched.length, 2);
});

test("requests for a document while it's being fetched share the fetch", async () => {
  const { resolve, fetched } = resolverWith({});
  const answers = await Promise.all([resolve(CLIENT_ID), resolve(CLIENT_ID), resolve(CLIENT_ID)]);
  assert.equal(fetched.length, 1);
  assert.ok(answers.every((answer) => answer.ok));
});

test("a failed fetch says why, and is kept a minute", async () => {
  const cases: Array<[string, Partial<FetchedDocument> | Error]> = [
    ["not_public", Object.assign(new Error("inside"), { code: "ENOTPUBLIC" })],
    ["too_large", Object.assign(new Error("big"), { code: "ETOOLARGE" })],
    ["timeout", Object.assign(new Error("slow"), { name: "TimeoutError" })],
    ["timeout", Object.assign(new Error("slow"), { name: "AbortError" })],
    ["unreachable", Object.assign(new Error("refused"), { code: "ECONNREFUSED" })],
    // A redirect isn't followed: the document must be at the client ID itself.
    ["bad_status", { status: 302 }],
    ["bad_status", { status: 404 }],
    ["not_json", { contentType: "text/html" }],
    ["not_json", { contentType: null }],
    ["not_json", { body: "{ not json" }],
    ["invalid", { body: JSON.stringify({ ...DOCUMENT, client_id: "https://evil.example/client.json" }) }],
  ];
  for (const [problem, answer] of cases) {
    const { resolve, fetched, advance } = resolverWith(answer, {});
    const result = await resolve(CLIENT_ID);
    assert.equal(!result.ok && result.problem, problem, JSON.stringify(answer));
    await resolve(CLIENT_ID);
    assert.equal(fetched.length, 1, problem);
    advance(MINUTE);
    assert.ok((await resolve(CLIENT_ID)).ok, problem);
  }
  for (const contentType of ["application/json; charset=utf-8", "application/oauth-client-metadata+json"]) {
    assert.ok((await resolverWith({ contentType }).resolve(CLIENT_ID)).ok, contentType);
  }
});

test("a client ID that isn't a document's address is never fetched", async () => {
  const { resolve, fetched } = resolverWith({});
  for (const clientId of ["aim_ci_abc", "https://169.254.169.254/latest/meta-data", "https://localhost/client.json"]) {
    const result = await resolve(clientId);
    assert.equal(!result.ok && result.problem, "not_metadata_url", clientId);
  }
  assert.equal(fetched.length, 0);
});
