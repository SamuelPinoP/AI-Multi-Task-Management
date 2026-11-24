// A task's description in sections (#433), the way a GitHub issue is written: each "## Title" line
// starts a section, and the text before the first one is the intro. The AI's tickets come in
// sections, and anyone can add their own on the task page, such as a "Cost" section. A description
// with no "## " line is plain text and stays exactly as it was. Plain functions, so the task page,
// the AI's card and the unit tests share them.

export type DescriptionSection = { title: string; body: string };

export type Description = {
  /** The text before the first section; "" for none. */
  intro: string;
  sections: DescriptionSection[];
};

/** Section titles are short, like headings. */
export const SECTION_TITLE_MAX = 80;

/**
 * The section a task's estimate goes in (#434). It shows on the task's page and in the AI's draft,
 * never in a list's preview of the description. Read and written in ../lib/estimates.ts.
 */
export const ESTIMATE_SECTION = "Estimate";

/** Whether a section's title makes it the estimate: "Estimate", in any case. */
export function isEstimateSection(title: string) {
  return title.trim().toLowerCase() === ESTIMATE_SECTION.toLowerCase();
}

/** "## Summary": a heading that starts a section, with up to three spaces before it, as in Markdown. */
const HEADING = /^ {0,3}##[ \t]+(\S.*?)(?:[ \t]+#+)?[ \t]*$/;
/** A fenced code block's fence: a "## " line inside one is code, not a heading. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** A list item: "- ", "* ", "+ " or "1. ". */
const LIST_ITEM = /^(?:[-*+]|\d{1,9}[.)])[ \t]+/;
/** A checklist item, "- [ ] Do it" or "- [x] Done": its marker, and whether it's ticked. */
const CHECKLIST_ITEM = /^([ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)\[([ xX])\]/;

function lines(text: string) {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

/** Without the blank lines at its start and the spaces at its end. */
function tidy(text: string) {
  return text.replace(/^(?:[ \t]*\n)+/, "").trimEnd();
}

/** Each line of `text` and whether it's inside a fenced code block (fence lines included). */
function linesWithFences(text: string) {
  let fence: string | null = null;
  return lines(text).map((line) => {
    const marker = FENCE.exec(line)?.[1];
    if (fence) {
      // A fence closes with the same character, at least as many times, and nothing after it.
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length).trim()) fence = null;
      return { line, code: true };
    }
    if (marker) {
      fence = marker;
      return { line, code: true };
    }
    return { line, code: false };
  });
}

/** A description split into its intro and its sections, in order. */
export function parseDescription(text: string): Description {
  const intro: string[] = [];
  const sections: Array<{ title: string; lines: string[] }> = [];
  for (const { line, code } of linesWithFences(text)) {
    const heading = code ? null : HEADING.exec(line);
    if (heading) sections.push({ title: heading[1], lines: [] });
    else (sections.at(-1)?.lines ?? intro).push(line);
  }
  return { intro: tidy(intro.join("\n")), sections: sections.map((section) => ({ title: section.title, body: tidy(section.lines.join("\n")) })) };
}

/** Whether a description has sections; one without is plain text. */
export function hasSections(text: string | null | undefined) {
  return Boolean(text) && parseDescription(text ?? "").sections.length > 0;
}

/** A title as a heading takes it: one line, no "#" in front, at most SECTION_TITLE_MAX characters. */
export function cleanSectionTitle(title: string) {
  return title
    .replace(/\s+/g, " ")
    .replace(/^[#\s]+/, "")
    .replace(/[\s#]+$/, "")
    .trim()
    .slice(0, SECTION_TITLE_MAX)
    .trim();
}

/** The description as text again: the intro, then each section under its "## " heading. */
export function serializeDescription({ intro, sections }: Description) {
  const blocks = intro.trim() ? [tidy(intro)] : [];
  for (const section of sections) {
    const heading = `## ${cleanSectionTitle(section.title) || "Untitled"}`;
    blocks.push(section.body.trim() ? `${heading}\n\n${tidy(section.body)}` : heading);
  }
  return blocks.join("\n\n");
}

/**
 * `body` with its checklist item on line `line` (1-based, as Markdown positions count) ticked or
 * not; null when that line isn't a checklist item.
 */
export function setChecklistItem(body: string, line: number, checked: boolean): string | null {
  const all = lines(body);
  const index = line - 1;
  const match = index >= 0 && index < all.length ? CHECKLIST_ITEM.exec(all[index]) : null;
  if (!match) return null;
  all[index] = `${match[1]}[${checked ? "x" : " "}]${all[index].slice(match[0].length)}`;
  return all.join("\n");
}

/** The section's top-level list items, outside code: "- one" and "- [ ] two" count, nested ones don't. */
export function listItems(body: string): string[] {
  return linesWithFences(body).flatMap(({ line, code }) => {
    if (code || !LIST_ITEM.test(line)) return [];
    return [line.replace(LIST_ITEM, "").replace(/^\[[ xX]\][ \t]*/, "").trim()];
  });
}

/** Its checklist items, ticked and in all, such as 2 of 5 acceptance criteria. */
export function checklistProgress(body: string) {
  let done = 0;
  let total = 0;
  for (const { line, code } of linesWithFences(body)) {
    const match = code ? null : CHECKLIST_ITEM.exec(line);
    if (!match) continue;
    total += 1;
    if (match[2] !== " ") done += 1;
  }
  return { done, total };
}

/** Markdown as one line of plain text: no headings, list markers, checkboxes, emphasis or link targets. */
export function plainText(markdown: string) {
  return lines(markdown)
    .map((line) =>
      line
        .replace(/^ {0,3}#{1,6}[ \t]+/, "")
        .replace(/^[ \t]*>[ \t]?/, "")
        .replace(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]*)?/, "")
        .replace(/^ {0,3}(?:`{3,}|~{3,}).*$/, ""),
    )
    .join(" ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])([*_])(\S(?:.*?\S)?)\2(?=[\s).,;:!?]|$)/g, "$1$3")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The description as a list shows it on one line. A plain one comes back as it is, so it looks the
 * same as before; one in sections shows its first text, such as the ticket's summary, but never the
 * estimate (#434), which stays off task rows and lists. A task with nothing but its estimate shows none.
 */
export function descriptionPreview(text: string | null | undefined) {
  if (!text) return "";
  const parsed = parseDescription(text);
  if (!parsed.sections.length) return text;
  const blocks = [parsed.intro, ...parsed.sections.filter((section) => !isEstimateSection(section.title)).map((section) => section.body)];
  const first = blocks.find((block) => plainText(block));
  return first ? plainText(first) : "";
}

/** A line of the model's as Markdown that can't start a heading, a quote or a code block, or end the list. */
export function escapeLine(text: string) {
  return text.replace(/^(\s*)(#|>|`{3}|~{3})/, "$1\\$2");
}

/** One list item, or one line of the model's: on one line, without the list marker or checkbox it may have added. */
export function listLine(text: string) {
  return escapeLine(
    text
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^(?:(?:[-*+]|\d{1,9}[.)])\s+|\[[ xX]\]\s*)+/, ""),
  );
}
