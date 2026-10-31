import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { ACCENTS } from "./accent";

/*
 * The color tokens in src/app/globals.css keep text readable, WCAG AA (4.5:1),
 * on every surface it can sit on, in both themes (DES-04, DES-09) and every
 * accent palette (DES-15).
 */

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The hex colors set in every block whose selector list includes this selector, later blocks winning. */
function tokens(selector: string) {
  const found: Record<string, string> = {};
  for (const [, names, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // The first block's text also holds the @import lines before it.
    const selectors = names.split(";").pop()?.split(",").map((name) => name.trim());
    if (!selectors?.includes(selector)) continue;
    for (const [, token, hex] of body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)) found[token] = hex.toLowerCase();
  }
  return found;
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5]
    .map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/** What every palette sets in both themes; the light block also holds the zinc grays the two share. */
const PALETTE = ["canvas", "surface", "raised", "sunken", "surface-hover", "ink", "muted", "line", "accent", "accent-hover", "accent-ink", "accent-soft"];
const ZINC = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => `color-zinc-${step}`);

const TEXT = ["ink", "muted", "color-zinc-500", "accent", "danger", "warning", "caution", "success"];
const SURFACES = ["canvas", "sunken", "surface", "raised", "surface-hover"];
const PILLS = [
  ["accent", "accent-soft"],
  ["danger", "danger-soft"],
  ["warning", "warning-soft"],
  ["caution", "caution-soft"],
  ["success", "success-soft"],
  ["accent-ink", "accent"],
];

function failures(colors: Record<string, string>, pairs: string[][]) {
  return pairs.flatMap(([fg, bg]) => {
    assert.ok(colors[fg] && colors[bg], `missing --${fg} or --${bg}`);
    const ratio = contrast(colors[fg], colors[bg]);
    return ratio < 4.5 ? [`${fg} on ${bg}: ${ratio.toFixed(2)}:1`] : [];
  });
}

for (const { id, name } of ACCENTS) {
  const palette = `[data-accent="${id}"]`;
  // As the cascade on <html> applies them: :root and the zinc @theme, then the
  // palette; in dark mode .dark, then the palette's dark block, which outranks both.
  const light = { ...tokens(":root"), ...tokens("@theme"), ...tokens(palette) };
  const dark = { ...light, ...tokens(".dark"), ...tokens(`.dark${palette}`) };

  test(`${name}: the palette sets every color in both themes`, () => {
    assert.deepEqual([...PALETTE, ...ZINC].filter((token) => !tokens(palette)[token]), []);
    assert.deepEqual([...PALETTE, "color-zinc-500"].filter((token) => !tokens(`.dark${palette}`)[token]), []);
  });

  for (const [theme, colors] of Object.entries({ light, dark })) {
    test(`${name}, ${theme} theme: text passes 4.5:1 on every surface`, () => {
      assert.deepEqual(failures(colors, TEXT.flatMap((fg) => SURFACES.map((bg) => [fg, bg]))), []);
    });

    test(`${name}, ${theme} theme: status pills and accent buttons pass 4.5:1`, () => {
      assert.deepEqual(failures(colors, PILLS), []);
    });
  }

  test(`${name}, dark theme: surfaces step up from the page to raised panels`, () => {
    const steps = ["canvas", "sunken", "surface", "raised"].map((token) => luminance(dark[token]));
    for (let i = 1; i < steps.length; i++) {
      assert.ok(steps[i] > steps[i - 1] * 1.2, `step ${i} is too close to the one below it`);
    }
  });
}

test("the accent palettes in globals.css match the teal tokens", () => {
  // Fails with the script's message when a teal token changed and the script didn't run.
  execFileSync(process.execPath, ["scripts/generate-accent-palettes.mjs", "--check"], { stdio: "pipe" });
});
