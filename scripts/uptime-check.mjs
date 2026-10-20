// Checks that production answers the way a visitor would see it, retrying a
// few times before calling it down. Prints a Markdown summary and exits 1 when
// the site is down. Used by .github/workflows/uptime.yml.
// These checks don't touch the database, so they don't wake Neon's free compute.
const baseUrl = (process.env.UPTIME_URL || "https://ai-multi-task-management-vercel.vercel.app").replace(/\/+$/, "");
const attempts = Number(process.env.UPTIME_ATTEMPTS || 3);
const retryDelayMs = Number(process.env.UPTIME_RETRY_DELAY_MS || 60_000);

const checks = [
  { name: "Login page loads", path: "/login", expect: 200 },
  { name: "Signed-out visitors are sent to log in", path: "/projects", expect: 307 },
  { name: "The API answers (refuses signed-out requests)", path: "/api/projects", expect: 401 },
];

async function runChecks() {
  const results = [];
  for (const check of checks) {
    const started = Date.now();
    try {
      const response = await fetch(`${baseUrl}${check.path}`, {
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
        headers: { "user-agent": "ai-multi-uptime-check" },
      });
      results.push({ ...check, status: response.status, ok: response.status === check.expect, ms: Date.now() - started });
    } catch (error) {
      results.push({ ...check, status: error.name === "TimeoutError" ? "timed out" : error.message, ok: false, ms: Date.now() - started });
    }
  }
  return results;
}

let results = [];
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  results = await runChecks();
  if (results.every((result) => result.ok)) break;
  if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
}

const up = results.every((result) => result.ok);
console.log(`${up ? "Up" : "Down"}: ${baseUrl}, checked ${new Date().toISOString()}${up ? "" : ` (failed ${attempts} times in a row)`}`);
console.log();
console.log("| Check | Expected | Got | Time |");
console.log("| --- | --- | --- | --- |");
for (const result of results) {
  console.log(`| ${result.ok ? "✅" : "❌"} ${result.name} (\`${result.path}\`) | ${result.expect} | ${result.status} | ${result.ms} ms |`);
}
process.exit(up ? 0 : 1);
