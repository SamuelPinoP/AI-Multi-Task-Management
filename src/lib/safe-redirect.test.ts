import assert from "node:assert/strict";
import test from "node:test";
import { getSafeRedirectPath } from "./safe-redirect";

test("keeps same-site paths with their query and hash", () => {
  assert.equal(getSafeRedirectPath("/"), "/");
  assert.equal(getSafeRedirectPath("/projects?tab=chat#x"), "/projects?tab=chat#x");
});

test("falls back to / when there is no path", () => {
  assert.equal(getSafeRedirectPath(""), "/");
  assert.equal(getSafeRedirectPath(null), "/");
  assert.equal(getSafeRedirectPath(undefined), "/");
});

test("rejects paths that the URL parser would send to another host", () => {
  for (const nextPath of [
    "//evil.com",
    "/\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "/.//evil.com",
    "/%2e//evil.com",
  ]) {
    assert.equal(getSafeRedirectPath(nextPath), "/", JSON.stringify(nextPath));
  }
});

test("rejects absolute URLs and anything not starting with /", () => {
  for (const nextPath of ["https://evil.com", "javascript:alert(1)", " /x"]) {
    assert.equal(getSafeRedirectPath(nextPath), "/", JSON.stringify(nextPath));
  }
});
