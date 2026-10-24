import assert from "node:assert/strict";
import test from "node:test";
import { authPageHref, invitationHref } from "./auth-links";

test("links to the bare page when there is nothing to keep", () => {
  assert.equal(authPageHref("login"), "/login");
  assert.equal(authPageHref("signup", { email: "", next: "/" }), "/signup");
});

test("keeps the email and the page to return to", () => {
  assert.equal(authPageHref("login", { email: "sam@example.com", next: "/projects" }), "/login?email=sam%40example.com&next=%2Fprojects");
  assert.equal(authPageHref("signup", { next: "/tasks?view=board" }), "/signup?next=%2Ftasks%3Fview%3Dboard");
});

test("puts the error first, so the page reads it like before", () => {
  assert.equal(authPageHref("login", { error: "created", email: "a+b@example.com" }), "/login?error=created&email=a%2Bb%40example.com");
  assert.equal(authPageHref("login", { error: "rate-limited", retry: 60, next: "/notes" }), "/login?error=rate-limited&retry=60&next=%2Fnotes");
});

test("sends existing accounts to log in and new addresses to sign up, then to the invitations", () => {
  assert.equal(invitationHref("sam@example.com", true), "/login?email=sam%40example.com&next=%2Fprojects");
  assert.equal(invitationHref("new@example.com", false), "/signup?email=new%40example.com&next=%2Fprojects");
});

test("round-trips through the URL parser", () => {
  const url = new URL(invitationHref("o'neil+test@example.com", true), "http://local.invalid");
  assert.equal(url.searchParams.get("email"), "o'neil+test@example.com");
  assert.equal(url.searchParams.get("next"), "/projects");
});
