import assert from "node:assert/strict";
import test from "node:test";
import { isAppAdminAccount, parseAdminEmails } from "./app-admin-core";

const confirmed = new Date("2026-11-01T10:00:00Z");
const account = (email: string, overrides: { isGuest?: boolean; emailVerifiedAt?: Date | null } = {}) => ({
  email,
  isGuest: false,
  emailVerifiedAt: confirmed,
  ...overrides,
});

test("ADMIN_EMAILS lists lowercase addresses, split by commas, semicolons or spaces", () => {
  assert.deepEqual([...parseAdminEmails(" Owner@Example.com, second@example.com;third@example.com  fourth@example.com,, ")], [
    "owner@example.com",
    "second@example.com",
    "third@example.com",
    "fourth@example.com",
  ]);
});

test("an unset or empty ADMIN_EMAILS makes nobody an admin", () => {
  for (const value of [undefined, "", "  ", ",;"]) {
    const admins = parseAdminEmails(value);
    assert.equal(admins.size, 0);
    assert.equal(isAppAdminAccount(account("owner@example.com"), admins), false);
  }
});

test("a listed account with a confirmed email is an admin, whatever the case", () => {
  const admins = parseAdminEmails("owner@example.com,second@example.com");
  assert.equal(isAppAdminAccount(account("owner@example.com"), admins), true);
  assert.equal(isAppAdminAccount(account("second@example.com"), admins), true);
  assert.equal(isAppAdminAccount(account("Owner@Example.COM"), parseAdminEmails("OWNER@example.com")), true);
});

test("everyone else is not: other addresses, lookalikes, the signed out", () => {
  const admins = parseAdminEmails("owner@example.com");
  assert.equal(isAppAdminAccount(account("someone@example.com"), admins), false);
  // Only the exact address counts: no dots, plus tags or partial matches.
  for (const email of ["o.wner@example.com", "owner+usage@example.com", "owner@example.co", "xowner@example.com", "owner@example.com.evil.test"]) {
    assert.equal(isAppAdminAccount(account(email), admins), false, email);
  }
  assert.equal(isAppAdminAccount(null, admins), false);
  assert.equal(isAppAdminAccount(undefined, admins), false);
});

test("a listed address doesn't count until its account confirms it, and guests never count", () => {
  const admins = parseAdminEmails("owner@example.com,guest-1@guest.local");
  assert.equal(isAppAdminAccount(account("owner@example.com", { emailVerifiedAt: null }), admins), false);
  assert.equal(isAppAdminAccount(account("guest-1@guest.local", { isGuest: true, emailVerifiedAt: null }), admins), false);
  assert.equal(isAppAdminAccount(account("guest-1@guest.local", { isGuest: true }), admins), false);
});
