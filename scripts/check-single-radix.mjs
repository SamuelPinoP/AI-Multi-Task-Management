// Fails when package-lock.json installs any @radix-ui package in more than one
// version. Duplicate copies give Radix components separate contexts, which can
// break a menu inside a dialog. The "overrides" entry in package.json keeps
// Prisma Studio's Radix dependencies on the app's release; when a Radix update
// lands, update that override to the matching release.
import { readFileSync } from "node:fs";

const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const versions = new Map();

for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  const match = /node_modules\/(@radix-ui\/[^/]+)$/.exec(path);
  if (!match) continue;
  if (!versions.has(match[1])) versions.set(match[1], new Set());
  versions.get(match[1]).add(entry.version);
}

const duplicates = [...versions].filter(([, found]) => found.size > 1);

if (duplicates.length > 0) {
  console.error("Radix UI is installed in more than one version:");
  for (const [name, found] of duplicates) console.error(`- ${name}: ${[...found].join(", ")}`);
  console.error('Update the "overrides" entry in package.json to the Radix release the app uses, then run npm install.');
  process.exit(1);
}

console.log(`Radix UI: ${versions.size} packages, one version each.`);
