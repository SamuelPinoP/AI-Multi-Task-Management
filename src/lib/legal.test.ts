import assert from "node:assert/strict";
import test from "node:test";
import { LEGAL_CONTACT_EMAIL, MINIMUM_AGE, PRIVACY_PATH, siteVerification, TERMS_PATH } from "./legal";

test("Search Console's tag is added only when its code is set", () => {
  assert.equal(siteVerification({}), undefined);
  assert.equal(siteVerification({ GOOGLE_SITE_VERIFICATION: "  " }), undefined);
  assert.deepEqual(siteVerification({ GOOGLE_SITE_VERIFICATION: " abc123-XYZ_456abc123-XYZ " }), { google: "abc123-XYZ_456abc123-XYZ" });
});

test("the documents live where Google's Branding page and other apps expect them", () => {
  assert.equal(PRIVACY_PATH, "/privacy");
  assert.equal(TERMS_PATH, "/terms");
  assert.match(LEGAL_CONTACT_EMAIL, /^[^@\s]+@[^@\s]+\.[a-z]+$/);
  // The Gemini API may not be part of an app likely to be used by anyone under 18 (#256).
  assert.equal(MINIMUM_AGE, 18);
});
