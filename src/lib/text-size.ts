/**
 * The text sizes you can pick in the account menu (DES-19, #338). Each one is
 * a root font size in src/app/globals.css, applied by data-text-size on <html>
 * (see theme-provider.tsx). Every size in the app is in rem, so text, icons
 * and spacing scale together. Default leaves the browser's own size.
 */
export const TEXT_SIZES = [
  { id: "small", name: "Small", rootSize: "93.75%" },
  { id: "default", name: "Default", rootSize: "100%" },
  { id: "large", name: "Large", rootSize: "112.5%" },
  { id: "larger", name: "Larger", rootSize: "125%" },
] as const;

export type TextSize = (typeof TEXT_SIZES)[number]["id"];

export const DEFAULT_TEXT_SIZE: TextSize = "default";

export function isTextSize(value: unknown): value is TextSize {
  return TEXT_SIZES.some((size) => size.id === value);
}

export function textSizeName(textSize: TextSize) {
  return TEXT_SIZES.find((size) => size.id === textSize)?.name ?? "Default";
}
