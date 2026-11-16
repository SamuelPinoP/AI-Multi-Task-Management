import assert from "node:assert/strict";
import test from "node:test";
import { FREE_TIER_EXCLUDED_COUNTRIES, regionAllowed } from "./region";

test("on the free tier, the EEA, Switzerland and the UK get the planner", () => {
  for (const country of ["DE", "FR", "IE", "GR", "NO", "IS", "LI", "CH", "GB", "RE", "AX"]) {
    assert.equal(regionAllowed(country, true), false, country);
  }
  assert.equal(regionAllowed(" de ", true), false, "however the header is written");
});

test("everyone else, and requests with no country, may use the model", () => {
  for (const country of ["US", "CA", "MX", "BR", "IN", "JP", "AU", "TR", "UA", "RS"]) {
    assert.equal(regionAllowed(country, true), true, country);
  }
  assert.equal(regionAllowed(null, true), true, "local development and tests send no country");
  assert.equal(regionAllowed("", true), true);
});

test("a paid key serves every country", () => {
  assert.equal(regionAllowed("DE", false), true);
  assert.equal(regionAllowed("GB", false), true);
});

test("the list has the 27 EU countries, the rest of the EEA, Switzerland and the UK", () => {
  const eu = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];
  assert.equal(eu.length, 27);
  for (const code of [...eu, "IS", "LI", "NO", "CH", "GB", "UK"]) assert.ok(FREE_TIER_EXCLUDED_COUNTRIES.has(code), code);
  for (const code of ["US", "TR", "UA", "RS", "AL", "BA", "MK", "ME", "MD", "GI", "JE"]) {
    assert.equal(FREE_TIER_EXCLUDED_COUNTRIES.has(code), false, `${code} is outside the EEA, Switzerland and the UK`);
  }
});
