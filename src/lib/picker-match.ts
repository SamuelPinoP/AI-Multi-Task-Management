/**
 * How the task property pickers rank an option against what was typed (#352):
 * 1 when one of its words starts with the search, 0.8 when a later word does,
 * 0.5 when the search appears anywhere, and 0 (hidden) otherwise. Case and
 * surrounding spaces don't matter, and an empty search keeps every option.
 */
export function matchPickerOption(search: string, words: readonly string[] = []): number {
  const query = search.trim().toLowerCase();
  if (!query) return 1;
  let best = 0;
  for (const word of words) {
    const text = word.toLowerCase();
    if (text.startsWith(query)) return 1;
    if (text.includes(` ${query}`)) best = Math.max(best, 0.8);
    else if (text.includes(query)) best = Math.max(best, 0.5);
  }
  return best;
}
