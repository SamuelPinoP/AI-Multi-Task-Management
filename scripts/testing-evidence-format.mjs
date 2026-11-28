// The testing-evidence table (#231) as Markdown, ready to paste into a pull request's description.
// No side effects, so it has tests (testing-evidence-format.test.mjs); testing-evidence.mjs runs the
// checks and prints it.

/** An @-mention as GitHub reads one outside code: an account's name, or a scoped package such as @prisma/client. */
const HANDLE = /(^|[^\w`])(@[A-Za-z0-9][\w-]*(?:\/[\w.-]*[\w-])?)/g;

/**
 * `text` with each @name outside code formatting put in it. In a PR's description a bare one
 * @-mentions that GitHub account: the Radix check's "one version of each @radix-ui package" did, on
 * every PR that pasted the table. Email addresses and code spans stay as they are.
 */
export function withoutMentions(text) {
  return text
    .split(/(`[^`]*`)/)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(HANDLE, (_match, before, handle) => `${before}\`${handle}\``)))
    .join("");
}

/** The table: where the checks ran, then one row a check with its command and result. It @-mentions nobody. */
export function evidenceTable(where, rows) {
  const lines = [`Checks run on ${where}:`, "", "| Check | Command | Result |", "|---|---|---|"];
  for (const row of rows) lines.push(`| ${row.name} | ${row.command} | ${row.result} |`);
  return lines.map(withoutMentions).join("\n");
}
