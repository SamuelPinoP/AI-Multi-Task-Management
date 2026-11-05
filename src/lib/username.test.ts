import assert from "node:assert/strict";
import test from "node:test";
import { checkUsername, normalizeUsername, parseLoginIdentifier, USERNAME_INPUT_PATTERN } from "./username";

test("usernames are saved trimmed and in lowercase", () => {
  assert.equal(normalizeUsername("  Samuel.Pino "), "samuel.pino");
  assert.deepEqual(checkUsername(" Samuel_99 "), { username: "samuel_99", error: null });
});

test("letters, numbers and single symbols between them are allowed", () => {
  for (const name of ["sam", "samuel-pino", "s.pino", "dev_2026", "a1b", "x".repeat(30), "007"]) {
    assert.equal(checkUsername(name).error, null, name);
  }
});

test("usernames are 3 to 30 characters", () => {
  assert.equal(checkUsername("").error, "Choose a username.");
  assert.equal(checkUsername("   ").error, "Choose a username.");
  assert.equal(checkUsername("ab").error, "Usernames are 3 to 30 characters long.");
  assert.equal(checkUsername("x".repeat(31)).error, "Usernames are 3 to 30 characters long.");
});

test("other characters are refused, so a username never looks like an email", () => {
  for (const name of ["sam@example.com", "sam pino", "sam+1", "samuel!", "piño", "sam/pino"]) {
    assert.equal(checkUsername(name).error, "Use only letters, numbers, periods, hyphens and underscores.", name);
  }
});

test("symbols go between letters or numbers, one at a time", () => {
  for (const name of [".sam", "sam.", "-sam", "sam_", "sam..pino", "sam-_pino", "s__p"]) {
    assert.equal(
      checkUsername(name).error,
      "Start and end with a letter or number, and don't put two symbols together.",
      name,
    );
  }
});

test("names that could pass for the app or its staff are reserved, with or without symbols", () => {
  for (const name of ["admin", "Admin", "a.d.m.i.n", "ai-multi", "AI_Multi", "support", "no-reply", "root"]) {
    assert.equal(checkUsername(name).error, "That username is reserved. Try another one.", name);
  }
  assert.equal(checkUsername("admin-sam").error, null);
});

test("the browser's pattern agrees with the server's rules", () => {
  // Browsers anchor `pattern` to the whole value and compile it with the v flag.
  const pattern = new RegExp(`^(?:${USERNAME_INPUT_PATTERN})$`, "v");
  for (const name of ["sam", "Samuel.Pino", "dev_2026", "a-b-c", "x".repeat(30)]) {
    assert.equal(pattern.test(name), true, name);
    assert.equal(checkUsername(name).error, null, name);
  }
  for (const name of ["ab", "x".repeat(31), ".sam", "sam.", "sam..pino", "sam pino", "sam@example.com"]) {
    assert.equal(pattern.test(name), false, name);
    assert.notEqual(checkUsername(name).error, null, name);
  }
});

test("the login field reads an @ as an email and anything else as a username", () => {
  assert.deepEqual(parseLoginIdentifier("  Sam@Example.TEST "), { email: "sam@example.test" });
  assert.deepEqual(parseLoginIdentifier(" Samuel.Pino "), { username: "samuel.pino" });
  assert.equal(parseLoginIdentifier("   "), null);
  assert.equal(parseLoginIdentifier(""), null);
});
