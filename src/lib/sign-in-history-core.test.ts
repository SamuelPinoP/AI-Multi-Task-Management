import assert from "node:assert/strict";
import test from "node:test";
import {
  countryFromHeader,
  countryName,
  describeDevice,
  isLastActiveStale,
  lastActiveStaleBefore,
  signInHistoryCutoff,
} from "./sign-in-history-core";

const agents = {
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Safari/605.1.15",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1",
  chromeIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.0.0 Mobile/15E148 Safari/604.1",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36",
  samsungAndroid:
    "Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  firefoxLinux: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0",
  operaMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 OPR/125.0.0.0",
  headlessLinux:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36",
  chromebook:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  ipad: "Mozilla/5.0 (iPad; CPU OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1",
};

test("names the browser and system of common devices", () => {
  assert.equal(describeDevice(agents.chromeWindows), "Chrome on Windows");
  assert.equal(describeDevice(agents.edgeWindows), "Edge on Windows");
  assert.equal(describeDevice(agents.safariMac), "Safari on macOS");
  assert.equal(describeDevice(agents.safariIphone), "Safari on iPhone");
  assert.equal(describeDevice(agents.chromeIphone), "Chrome on iPhone");
  assert.equal(describeDevice(agents.chromeAndroid), "Chrome on Android");
  assert.equal(describeDevice(agents.samsungAndroid), "Samsung Internet on Android");
  assert.equal(describeDevice(agents.firefoxLinux), "Firefox on Linux");
  assert.equal(describeDevice(agents.operaMac), "Opera on macOS");
  assert.equal(describeDevice(agents.chromebook), "Chrome on ChromeOS");
  assert.equal(describeDevice(agents.ipad), "Safari on iPad");
});

test("counts the headless Chrome that tests use as Chrome", () => {
  assert.equal(describeDevice(agents.headlessLinux), "Chrome on Linux");
});

test("keeps whichever half it can tell, and gives up on nothing", () => {
  assert.equal(describeDevice("curl/8.9.1"), null);
  assert.equal(describeDevice("SomeBot (Windows NT 10.0)"), "Windows");
  assert.equal(describeDevice("Mozilla/5.0 Firefox/145.0"), "Firefox");
  assert.equal(describeDevice(""), null);
  assert.equal(describeDevice("   "), null);
  assert.equal(describeDevice(null), null);
  assert.equal(describeDevice(undefined), null);
});

test("reads only the start of an overlong header", () => {
  assert.equal(describeDevice(`${"x".repeat(600)} Chrome/142.0 (Windows NT 10.0)`), null);
  assert.equal(describeDevice(`${agents.chromeWindows}${"x".repeat(5000)}`), "Chrome on Windows");
});

test("takes the country only as two letters", () => {
  assert.equal(countryFromHeader("US"), "US");
  assert.equal(countryFromHeader(" de "), "DE");
  assert.equal(countryFromHeader(""), null);
  assert.equal(countryFromHeader(null), null);
  assert.equal(countryFromHeader(undefined), null);
  assert.equal(countryFromHeader("USA"), null);
  assert.equal(countryFromHeader("U1"), null);
  assert.equal(countryFromHeader("<script>"), null);
});

test("names countries in English, falling back to the code", () => {
  assert.equal(countryName("US"), "United States");
  assert.equal(countryName("DO"), "Dominican Republic");
  assert.equal(countryName("XX"), "XX");
});

test("refreshes the last-active date once it's an hour old", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  assert.equal(isLastActiveStale(null, now), true);
  assert.equal(isLastActiveStale(undefined, now), true);
  assert.equal(isLastActiveStale(new Date("2026-11-15T11:00:01Z"), now), false);
  assert.equal(isLastActiveStale(new Date("2026-11-15T11:00:00Z"), now), true);
  assert.equal(isLastActiveStale(new Date("2026-11-14T12:00:00Z"), now), true);
  assert.deepEqual(lastActiveStaleBefore(now), new Date("2026-11-15T11:00:00Z"));
});

test("keeps sign-ins for a year", () => {
  assert.deepEqual(signInHistoryCutoff(new Date("2026-11-15T12:00:00Z")), new Date("2025-11-15T12:00:00Z"));
});
