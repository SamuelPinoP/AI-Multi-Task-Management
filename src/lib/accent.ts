/**
 * The accent colors you can pick in the account menu (DES-15, #321). Each id
 * is a palette in src/app/globals.css, applied by data-accent on <html> (see
 * theme-provider.tsx). Teal is the brand's color and the default.
 */
export const ACCENTS = [
  { id: "teal", name: "Teal" },
  { id: "blue", name: "Blue" },
  { id: "violet", name: "Violet" },
  { id: "plum", name: "Plum" },
  { id: "graphite", name: "Graphite" },
] as const;

export type Accent = (typeof ACCENTS)[number]["id"];

export const DEFAULT_ACCENT: Accent = "teal";

export function isAccent(value: unknown): value is Accent {
  return ACCENTS.some((accent) => accent.id === value);
}

export function accentName(accent: Accent) {
  return ACCENTS.find((option) => option.id === accent)?.name ?? "Teal";
}
