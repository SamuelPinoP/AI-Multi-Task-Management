// Lighthouse reports record the headers they were sent, including the Vercel bypass
// secret. The preview workflow runs this before uploading .lighthouseci/ as an artifact,
// because artifacts of a public repository can be downloaded by anyone.
// Usage: node scripts/scrub-lighthouse-reports.mjs [directory]   (reads the secret from the environment)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const directory = process.argv[2] ?? ".lighthouseci";
const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
if (!secret) {
  console.log("No VERCEL_AUTOMATION_BYPASS_SECRET set; nothing to scrub.");
  process.exit(0);
}

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
  );
}

let scrubbed = 0;
for (const file of files(directory)) {
  const text = readFileSync(file, "utf8");
  if (!text.includes(secret)) continue;
  writeFileSync(file, text.split(secret).join("[redacted]"));
  scrubbed += 1;
}

const left = files(directory).filter((file) => readFileSync(file, "utf8").includes(secret));
if (left.length > 0) {
  console.error(`The bypass secret is still in ${left.length} file(s); not safe to upload.`);
  process.exit(1);
}
console.log(`Removed the bypass secret from ${scrubbed} file(s).`);
