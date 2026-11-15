import assert from "node:assert/strict";
import test from "node:test";
import { FREE_TIER_LIMITS, USAGE_DASHBOARDS } from "./free-tier-limits";
import {
  emailCountHour,
  emailSending,
  formatBytes,
  formatLimitValue,
  formatUsagePercent,
  last24HoursStart,
  MAX_BACKUP_LIST_PAGES,
  summarizeBackups,
  type BackupListPage,
  USAGE_DANGER_PERCENT,
  USAGE_WARNING_PERCENT,
  usageLevel,
  usageLevelText,
  usagePercent,
} from "./usage-core";

test("the percentage is the share of the limit used, past 100 when over", () => {
  assert.equal(usagePercent(0, 500), 0);
  assert.equal(usagePercent(250, 500), 50);
  assert.equal(usagePercent(500, 500), 100);
  assert.equal(usagePercent(600, 500), 120);
  assert.equal(usagePercent(2.5 * 1000 ** 3, 10 * 1000 ** 3), 25);
});

test("a limit of zero is full once anything is used, and bad numbers count as nothing used", () => {
  // PROJECT_CHAT_S3_QUOTA_BYTES="0" turns uploads off.
  assert.equal(usagePercent(0, 0), 0);
  assert.equal(usagePercent(1, 0), 100);
  assert.equal(usagePercent(-5, 100), 0);
  assert.equal(usagePercent(Number.NaN, 100), 0);
  assert.equal(usagePercent(10, Number.NaN), 100);
});

test("bars turn amber at 70% and red at 90%", () => {
  assert.equal(USAGE_WARNING_PERCENT, 70);
  assert.equal(USAGE_DANGER_PERCENT, 90);
  assert.equal(usageLevel(0), "ok");
  assert.equal(usageLevel(69.99), "ok");
  assert.equal(usageLevel(70), "warning");
  assert.equal(usageLevel(89.99), "warning");
  assert.equal(usageLevel(90), "danger");
  assert.equal(usageLevel(100), "danger");
  assert.equal(usageLevel(250), "danger");
  // From counts, as the page computes them: 350 and 450 of Gmail's 500.
  assert.equal(usageLevel(usagePercent(349, 500)), "ok");
  assert.equal(usageLevel(usagePercent(350, 500)), "warning");
  assert.equal(usageLevel(usagePercent(450, 500)), "danger");
});

test("amber and red bars say so in words too", () => {
  assert.equal(usageLevelText(69), null);
  assert.equal(usageLevelText(70), "Getting close");
  assert.equal(usageLevelText(90), "Nearly full");
  assert.equal(usageLevelText(100), "Over the limit");
  assert.equal(usageLevelText(140), "Over the limit");
});

test("percentages round down, so the text never reads 90% while the bar is amber", () => {
  assert.equal(formatUsagePercent(0), "0%");
  assert.equal(formatUsagePercent(0.004), "<1%");
  assert.equal(formatUsagePercent(0.99), "<1%");
  assert.equal(formatUsagePercent(1), "1%");
  assert.equal(formatUsagePercent(69.9), "69%");
  assert.equal(formatUsagePercent(89.99), "89%");
  assert.equal(formatUsagePercent(90), "90%");
  assert.equal(formatUsagePercent(120.4), "120%");
  assert.equal(formatUsagePercent(Number.NaN), "0%");
});

test("bytes read in decimal units, as the providers count them", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(999), "999 B");
  assert.equal(formatBytes(1000), "1 KB");
  assert.equal(formatBytes(1536), "1.54 KB");
  assert.equal(formatBytes(12_345_678), "12.3 MB");
  assert.equal(formatBytes(123_456_789), "123 MB");
  assert.equal(formatBytes(999_999), "1 MB");
  assert.equal(formatBytes(1000 ** 3), "1 GB");
  // The app's own R2 cap, 8 GiB.
  assert.equal(formatBytes(8 * 1024 ** 3), "8.59 GB");
  assert.equal(formatBytes(10 * 1000 ** 3), "10 GB");
  assert.equal(formatBytes(2 * 1000 ** 5), "2,000 TB");
  assert.equal(formatBytes(-1), "0 B");
});

test("each limit reads in its own unit", () => {
  assert.equal(formatLimitValue(FREE_TIER_LIMITS.r2Storage), "10 GB");
  assert.equal(formatLimitValue(FREE_TIER_LIMITS.neonStorage), "1 GB");
  assert.equal(formatLimitValue(FREE_TIER_LIMITS.gmailDaily), "500");
  assert.equal(formatLimitValue(FREE_TIER_LIMITS.vercelFunctionInvocations), "1,000,000");
});

test("every limit says when it was checked and where", () => {
  for (const [name, limit] of Object.entries(FREE_TIER_LIMITS)) {
    assert.ok(limit.value > 0, name);
    assert.match(limit.checkedOn, /^\d{4}-\d{2}-\d{2}$/, name);
    assert.ok(!Number.isNaN(Date.parse(`${limit.checkedOn}T00:00:00Z`)), name);
    assert.match(limit.source, /^https:\/\//, name);
    assert.ok(limit.plan && limit.label && limit.sourceTitle, name);
  }
  for (const href of Object.values(USAGE_DASHBOARDS)) assert.match(href, /^https:\/\//);
});

test("emails are counted per UTC hour, and the last 24 hours start a full day before this hour", () => {
  const now = new Date("2026-11-15T13:47:12.345Z");
  assert.equal(emailCountHour(now).toISOString(), "2026-11-15T13:00:00.000Z");
  assert.equal(emailCountHour(new Date("2026-11-15T13:00:00.000Z")).toISOString(), "2026-11-15T13:00:00.000Z");
  // The window reaches up to an hour past Gmail's rolling day, so it never undercounts.
  assert.equal(last24HoursStart(now).toISOString(), "2026-11-14T13:00:00.000Z");
  assert.equal(last24HoursStart(new Date("2026-11-01T00:30:00Z")).toISOString(), "2026-10-31T00:00:00.000Z");
});

test("backups add up across list pages, with the newest one's time", async () => {
  const tokens: Array<string | undefined> = [];
  const pages: BackupListPage[] = [
    {
      Contents: [
        { Size: 2_000_000, LastModified: new Date("2026-11-13T07:00:00Z") },
        { Size: 2_500_000, LastModified: new Date("2026-11-15T07:00:00Z") },
      ],
      IsTruncated: true,
      NextContinuationToken: "page-2",
    },
    { Contents: [{ Size: 1_000_000, LastModified: new Date("2026-11-14T07:00:00Z") }, { LastModified: undefined }], IsTruncated: false },
  ];
  const summary = await summarizeBackups(async (token) => {
    tokens.push(token);
    return pages[tokens.length - 1];
  });
  assert.deepEqual(summary, { count: 4, bytes: 5_500_000, newest: new Date("2026-11-15T07:00:00Z") });
  assert.deepEqual(tokens, [undefined, "page-2"]);
});

test("an empty bucket has no backups, and a listing that never ends stops", async () => {
  assert.deepEqual(await summarizeBackups(async () => ({})), { count: 0, bytes: 0, newest: null });
  let calls = 0;
  const endless = await summarizeBackups(async () => {
    calls += 1;
    return { Contents: [{ Size: 10 }], IsTruncated: true, NextContinuationToken: `page-${calls + 1}` };
  });
  assert.equal(calls, MAX_BACKUP_LIST_PAGES);
  assert.equal(endless.count, MAX_BACKUP_LIST_PAGES);
});

test("the daily email limit follows EMAIL_PROVIDER", () => {
  assert.deepEqual(emailSending({}), { status: "off" });
  assert.deepEqual(emailSending({ EMAIL_PROVIDER: "disabled" }), { status: "off" });
  assert.deepEqual(emailSending({ EMAIL_PROVIDER: "carrier-pigeon" }), { status: "off" });
  assert.deepEqual(emailSending({ EMAIL_PROVIDER: "smtp" }), { status: "limited", provider: "Gmail", limit: FREE_TIER_LIMITS.gmailDaily });
  assert.deepEqual(emailSending({ EMAIL_PROVIDER: " SMTP ", SMTP_HOST: "SMTP.gmail.com" }), {
    status: "limited",
    provider: "Gmail",
    limit: FREE_TIER_LIMITS.gmailDaily,
  });
  assert.deepEqual(emailSending({ EMAIL_PROVIDER: "smtp", SMTP_HOST: "mail.example.com" }), { status: "unknown-limit", provider: "mail.example.com" });
  assert.deepEqual(emailSending({ EMAIL_PROVIDER: "brevo" }), { status: "limited", provider: "Brevo", limit: FREE_TIER_LIMITS.brevoDaily });
  assert.deepEqual(emailSending({ EMAIL_PROVIDER: "resend" }), { status: "limited", provider: "Resend", limit: FREE_TIER_LIMITS.resendDaily });
});
