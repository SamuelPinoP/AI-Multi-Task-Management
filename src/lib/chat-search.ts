/**
 * Search inside one chat (#409). The open chat already holds every message in the
 * browser, so matching runs there: no request, no query.
 *
 * Matching ignores case and accents ("cafe" finds "Café") and treats any whitespace
 * as a space, so a phrase still matches across a line break. Results come newest
 * first: the match closest to the bottom of the chat is the first one shown.
 */

export type MatchRange = { start: number; end: number };

export type SearchableMessage = {
  id: string;
  message: string;
  attachments: Array<{ id: string; originalName: string }>;
};

export type ChatSearchResult = {
  id: string;
  /** Where the query appears in the message's text, in order. */
  ranges: MatchRange[];
  /** Attachments whose file name matches, with where. */
  files: Array<{ id: string; name: string; ranges: MatchRange[] }>;
};

/** One character as matching sees it: no accents, lower case, whitespace as a space. */
function foldChar(char: string) {
  if (/\s/.test(char)) return " ";
  return char.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

/**
 * The text as matching sees it, and for each of its characters the index in the
 * original text it came from, so a match can be mapped back for highlighting.
 */
export function foldForSearch(text: string): { folded: string; origin: number[] } {
  let folded = "";
  const origin: number[] = [];
  let index = 0;
  for (const char of text) {
    const piece = foldChar(char);
    for (let i = 0; i < piece.length; i += 1) origin.push(index);
    folded += piece;
    index += char.length;
  }
  return { folded, origin };
}

/** The query as matching sees it: folded, trimmed, runs of spaces made one. */
export function normalizeQuery(query: string) {
  return foldForSearch(query.trim()).folded.replace(/ {2,}/g, " ");
}

/** Every place the query appears in the text, as ranges of the original text; none for an empty query. */
export function findMatches(text: string, query: string): MatchRange[] {
  const needle = normalizeQuery(query);
  if (!needle || !text) return [];
  const { folded, origin } = foldForSearch(text);
  const ranges: MatchRange[] = [];
  for (let at = folded.indexOf(needle); at !== -1; at = folded.indexOf(needle, at + needle.length)) {
    const after = at + needle.length;
    ranges.push({ start: origin[at], end: after < origin.length ? origin[after] : text.length });
  }
  return ranges;
}

/** The messages that match, newest first. Messages still sending ("pending-…") are left out. */
export function searchChat(messages: SearchableMessage[], query: string): ChatSearchResult[] {
  if (!normalizeQuery(query)) return [];
  const results: ChatSearchResult[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.id.startsWith("pending-")) continue;
    const ranges = findMatches(message.message, query);
    const files = message.attachments
      .map((attachment) => ({ id: attachment.id, name: attachment.originalName, ranges: findMatches(attachment.originalName, query) }))
      .filter((file) => file.ranges.length > 0);
    if (ranges.length || files.length) results.push({ id: message.id, ranges, files });
  }
  return results;
}

/** The text cut into plain and matched pieces, for rendering highlights. */
export function highlightSegments(text: string, ranges: MatchRange[]): Array<{ text: string; match: boolean }> {
  const segments: Array<{ text: string; match: boolean }> = [];
  let index = 0;
  for (const { start, end } of ranges) {
    if (start < index || end <= start) continue;
    if (start > index) segments.push({ text: text.slice(index, start), match: false });
    segments.push({ text: text.slice(start, end), match: true });
    index = end;
  }
  if (index < text.length) segments.push({ text: text.slice(index), match: false });
  return segments;
}

/**
 * A short piece of a long message around its first match, for a results list: up to
 * `length` characters, starting about `before` characters ahead of the match and cut
 * at spaces where one is near, with "…" where text was left out. Line breaks become spaces.
 */
export function snippetAround(text: string, ranges: MatchRange[], { before = 40, length = 140 } = {}): { text: string; ranges: MatchRange[] } {
  const flat = text.replace(/\s/g, " ");
  if (flat.length <= length) return { text: flat, ranges };
  const first = ranges[0]?.start ?? 0;
  let start = Math.max(0, Math.min(first - before, flat.length - length));
  if (start > 0) {
    const space = flat.indexOf(" ", start);
    if (space !== -1 && space < first && space - start <= 15) start = space + 1;
  }
  let end = Math.min(flat.length, start + length);
  if (end < flat.length) {
    const space = flat.lastIndexOf(" ", end);
    const lastMatchEnd = ranges.filter((range) => range.start < end).at(-1)?.end ?? 0;
    if (space > start && end - space <= 15 && space >= lastMatchEnd) end = space;
  }
  const prefix = start > 0 ? "…" : "";
  const shift = prefix.length - start;
  return {
    text: `${prefix}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`,
    ranges: ranges
      .filter((range) => range.end > start && range.start < end)
      .map((range) => ({ start: Math.max(range.start, start) + shift, end: Math.min(range.end, end) + shift })),
  };
}
