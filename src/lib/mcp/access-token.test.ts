import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { ACCESS_TOKEN_PREFIX, ACCESS_TOKEN_SECONDS, mintAccessToken, verifyAccessToken } from "./access-token";

const SECRET = "test-secret-that-is-long-enough-0123456789";
const RESOURCE = "https://ai-multi.example/api/mcp";
const NOW = new Date("2026-11-25T12:00:00.000Z");
const CLAIMS = { userId: "user-1", grantId: "grant-1", clientId: "https://claude.ai/oauth/claude-code-client-metadata", scopes: ["read"], resource: RESOURCE };

const mint = (overrides: Partial<typeof CLAIMS> & { expiresAt?: number } = {}, now = NOW) => mintAccessToken({ ...CLAIMS, ...overrides }, { secret: SECRET, now });
const verify = (token: string, { now = NOW, secret = SECRET, resource = RESOURCE } = {}) => verifyAccessToken(token, { secret, resource, now });

/** A token signed like a real one around any payload, to test what the verifier makes of odd contents. */
function signedToken(payload: unknown) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", SECRET).update(`${ACCESS_TOKEN_PREFIX}${encoded}`).digest("base64url");
  return `${ACCESS_TOKEN_PREFIX}${encoded}.${signature}`;
}

test("a token names the person, the app, its grant, its scopes and the endpoint, for an hour", () => {
  const token = mint({ scopes: ["read", "write"] });
  assert.match(token, /^aim_at_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(verify(token), {
    ok: true,
    claims: { ...CLAIMS, scopes: ["read", "write"], issuedAt: NOW.getTime() / 1000, expiresAt: NOW.getTime() / 1000 + ACCESS_TOKEN_SECONDS },
  });
  assert.equal(ACCESS_TOKEN_SECONDS, 3600);
});

test("checking a token needs only the secret: a changed payload, signature or secret fails", () => {
  const token = mint();
  const [payload, signature] = token.slice(ACCESS_TOKEN_PREFIX.length).split(".");
  const otherUser = Buffer.from(Buffer.from(payload, "base64url").toString().replace("user-1", "user-2")).toString("base64url");
  assert.deepEqual(verify(`${ACCESS_TOKEN_PREFIX}${otherUser}.${signature}`), { ok: false, reason: "bad_signature" });
  assert.deepEqual(verify(`${ACCESS_TOKEN_PREFIX}${payload}.${signature.slice(0, -2)}AA`), { ok: false, reason: "bad_signature" });
  // The same bytes written another way are refused too: only the exact token AI Multi issued works.
  assert.deepEqual(verify(`${token}=`), { ok: false, reason: "bad_signature" });
  assert.deepEqual(verify(`${token}!`), { ok: false, reason: "bad_signature" });
  assert.deepEqual(verify(token, { secret: `${SECRET}-rotated` }), { ok: false, reason: "bad_signature" });
});

test("a token works until its hour is up, and not before it was issued", () => {
  const token = mint();
  const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);
  assert.equal(verify(token, { now: at(ACCESS_TOKEN_SECONDS - 1) }).ok, true);
  assert.deepEqual(verify(token, { now: at(ACCESS_TOKEN_SECONDS) }), { ok: false, reason: "expired" });
  // A minute's leeway for clocks that differ, then no more.
  assert.equal(verify(token, { now: at(-60) }).ok, true);
  assert.deepEqual(verify(token, { now: at(-61) }), { ok: false, reason: "not_yet_valid" });
});

test("a token works only at the endpoint it was issued for (RFC 8707)", () => {
  assert.deepEqual(verify(mint(), { resource: "https://preview.ai-multi.example/api/mcp" }), { ok: false, reason: "wrong_resource" });
  assert.deepEqual(verify(mint({ resource: "https://ai-multi.example/api/mcp/" })), { ok: false, reason: "wrong_resource" });
});

test("anything that isn't a token AI Multi signed is refused without trusting its contents", () => {
  for (const token of ["", "Bearer x", "aim_at_", "aim_at_abc", "aim_at_.sig", "aim_at_a.b.c", "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1In0.", `aim_at_${"a".repeat(9000)}.b`]) {
    assert.equal(verify(token).ok, false, JSON.stringify(token.slice(0, 40)));
  }
  const valid = { v: 1, sub: "user-1", gid: "grant-1", cid: "client", scope: "read", aud: RESOURCE, iat: NOW.getTime() / 1000, exp: NOW.getTime() / 1000 + 60 };
  assert.equal(verify(signedToken(valid)).ok, true);
  for (const payload of [null, [], "text", { ...valid, v: 2 }, { ...valid, sub: "" }, { ...valid, sub: 7 }, { ...valid, exp: "soon" }, { ...valid, iat: 1.5 }, { ...valid, scope: ["read"] }]) {
    assert.deepEqual(verify(signedToken(payload)), { ok: false, reason: "malformed" }, JSON.stringify(payload));
  }
});

test("a secret too short to be safe is refused when minting and when checking", () => {
  assert.throws(() => mintAccessToken(CLAIMS, { secret: "short" }), /at least 32 characters/);
  assert.throws(() => verifyAccessToken(mint(), { secret: "short", resource: RESOURCE }), /at least 32 characters/);
});
