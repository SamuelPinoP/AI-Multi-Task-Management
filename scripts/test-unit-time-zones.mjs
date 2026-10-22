// TEST-01 (#140): runs `npm run test:unit` with the process in other time zones.
// Date code can pass in UTC (CI's own zone) and still break for a user far from it,
// so each zone below stresses a different edge: the date line on both sides, a
// half-hour offset, and daylight saving time.
//
// Usage: npm run test:unit:zones [-- Zone/Name ...]
// TZ is set here, inside Node, because Git Bash on Windows drops TZ values with a "/".
import { spawnSync } from "node:child_process";

const defaultZones = ["Pacific/Pago_Pago", "America/New_York", "Asia/Kolkata", "Pacific/Kiritimati"];
const zones = process.argv.length > 2 ? process.argv.slice(2) : defaultZones;
const isWindows = process.platform === "win32";

// A run that silently stays in the machine's zone would pass for the wrong reason, so
// check that a child process really sees each zone's UTC offset first.
const sample = new Date(Date.UTC(2026, 0, 15, 12));
function expectedOffset(zone) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
    .formatToParts(sample)
    .find((part) => part.type === "timeZoneName").value;
  const match = name.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  return match ? (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
}
function childOffset(zone) {
  const script = `console.log(-new Date(${sample.getTime()}).getTimezoneOffset())`;
  const result = spawnSync(process.execPath, ["-e", script], { env: { ...process.env, TZ: zone }, encoding: "utf8" });
  return Number(result.stdout.trim());
}

const failed = [];
for (const zone of zones) {
  console.log(`\n=== npm run test:unit with TZ=${zone}`);
  if (childOffset(zone) !== expectedOffset(zone)) {
    console.error(`TZ=${zone} did not reach the test process (it ran at UTC offset ${childOffset(zone)} minutes).`);
    failed.push(zone);
    continue;
  }
  const result = spawnSync(isWindows ? "npm.cmd" : "npm", ["run", "test:unit"], {
    stdio: "inherit",
    env: { ...process.env, TZ: zone },
    // Windows can only start npm.cmd through a shell.
    shell: isWindows,
  });
  if (result.status !== 0) failed.push(zone);
}

if (failed.length > 0) {
  console.error(`\nUnit tests failed with TZ=${failed.join(", ")}.`);
  process.exit(1);
}
console.log(`\nUnit tests passed with TZ=${zones.join(", ")}.`);
