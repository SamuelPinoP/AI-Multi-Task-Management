// Writes the accent palettes (DES-15, #321) into src/app/globals.css, between
// the "Accent palettes" comments: Teal, Blue, Violet, Plum and Graphite, each
// for light and dark mode. Run `node scripts/generate-accent-palettes.mjs`
// after changing a teal token or a palette below; the output is committed.
// With `--check` it only reports whether globals.css is current, which
// src/lib/design-tokens.test.ts runs.
//
// Teal is copied from :root and .dark as it is. The other palettes keep every
// teal neutral's OKLCH lightness and chroma and turn its hue, so text keeps the
// contrast the teal tokens were checked for. Their accents are picked by hand,
// and design-tokens.test.ts checks every palette for 4.5:1.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "src/app/globals.css");
const BEGIN = "/* Accent palettes (DES-15): written by scripts/generate-accent-palettes.mjs. Edit the script, not these blocks. */";
const END = "/* End of the accent palettes. */";

/** The colors every palette sets, in both themes. */
const PALETTE = ["canvas", "surface", "raised", "sunken", "surface-hover", "ink", "muted", "line", "accent", "accent-hover", "accent-ink", "accent-soft"];
const ZINC = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => `color-zinc-${step}`);

/*
 * hue: the OKLCH hue the neutrals turn to. tint: their chroma next to teal's.
 * The accent colors are OKLCH [lightness, chroma, hue], or a hex.
 */
const PALETTES = {
  blue: {
    hue: 255,
    tint: 1.25,
    light: { accent: [0.5, 0.165, 258], "accent-hover": [0.44, 0.15, 258], "accent-ink": "#ffffff", "accent-soft": [0.94, 0.03, 258] },
    dark: { accent: [0.74, 0.12, 255], "accent-hover": [0.8, 0.1, 255], "accent-ink": [0.2, 0.042, 255], "accent-soft": [0.29, 0.06, 258] },
  },
  violet: {
    hue: 290,
    tint: 1.25,
    light: { accent: [0.5, 0.2, 288], "accent-hover": [0.44, 0.19, 288], "accent-ink": "#ffffff", "accent-soft": [0.94, 0.035, 290] },
    dark: { accent: [0.75, 0.13, 290], "accent-hover": [0.81, 0.11, 290], "accent-ink": [0.2, 0.045, 290], "accent-soft": [0.29, 0.07, 290] },
  },
  plum: {
    hue: 340,
    tint: 1.15,
    light: { accent: [0.48, 0.15, 338], "accent-hover": [0.42, 0.14, 338], "accent-ink": "#ffffff", "accent-soft": [0.94, 0.03, 340] },
    dark: { accent: [0.76, 0.105, 340], "accent-hover": [0.82, 0.09, 340], "accent-ink": [0.2, 0.037, 340], "accent-soft": [0.29, 0.055, 340] },
  },
  // Near-black buttons on near-neutral grays. Its soft color is darker than
  // the others' so selected items still stand out from hovered ones.
  graphite: {
    hue: 255,
    tint: 0.45,
    light: { accent: [0.3, 0.012, 255], "accent-hover": [0.22, 0.01, 255], "accent-ink": "#ffffff", "accent-soft": [0.9, 0.008, 255] },
    dark: { accent: [0.9, 0.008, 255], "accent-hover": [0.96, 0.005, 255], "accent-ink": [0.2, 0.003, 255], "accent-soft": [0.36, 0.012, 255] },
  },
};

const toLinear = (channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
const fromLinear = (channel) => (channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055);

/** A hex color as OKLCH [lightness, chroma, hue]. */
function toOklch(hex) {
  const [r, g, b] = [1, 3, 5].map((start) => toLinear(parseInt(hex.slice(start, start + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, Math.hypot(a, bb), (Math.atan2(bb, a) * 180) / Math.PI];
}

function toLinearRgb([lightness, chroma, hue]) {
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** An OKLCH color as hex, with its chroma lowered until it fits sRGB. */
function toHex([lightness, chroma, hue]) {
  let rgb = toLinearRgb([lightness, chroma, hue]);
  for (let reduced = chroma; rgb.some((channel) => channel < -1e-4 || channel > 1 + 1e-4) && reduced > 0; ) {
    reduced = Math.max(0, reduced - 0.001);
    rgb = toLinearRgb([lightness, reduced, hue]);
  }
  return `#${rgb.map((channel) => Math.round(Math.min(1, Math.max(0, fromLinear(channel))) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** The hex colors set in every block whose selector list includes `selector`, later blocks winning. */
function tokens(css, selector) {
  const found = {};
  for (const [, names, body] of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // The first block's text also holds the @import lines before it.
    const selectors = names.split(";").pop().split(",").map((name) => name.trim());
    if (!selectors.includes(selector)) continue;
    for (const [, token, hex] of body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)) found[token] = hex.toLowerCase();
  }
  return found;
}

function pick(colors, names) {
  return Object.fromEntries(names.map((name) => {
    if (!colors[name]) throw new Error(`globals.css doesn't set --${name}`);
    return [name, colors[name]];
  }));
}

/** The light and dark colors of every palette, from the teal tokens. */
function palettes(css) {
  const teal = {
    light: pick({ ...tokens(css, ":root"), ...tokens(css, "@theme") }, [...PALETTE, ...ZINC]),
    dark: pick(tokens(css, ".dark"), [...PALETTE, "color-zinc-500"]),
  };
  const result = { teal };
  for (const [id, spec] of Object.entries(PALETTES)) {
    const turn = (hex) => {
      if (hex === "#ffffff") return hex;
      const [lightness, chroma] = toOklch(hex);
      return toHex([lightness, chroma * spec.tint, spec.hue]);
    };
    const accent = (value) => (typeof value === "string" ? value : toHex(value));
    result[id] = Object.fromEntries(
      ["light", "dark"].map((theme) => [
        theme,
        Object.fromEntries(
          Object.entries(teal[theme]).map(([name, hex]) => [name, name in spec[theme] ? accent(spec[theme][name]) : turn(hex)]),
        ),
      ]),
    );
  }
  return result;
}

function block(selector, colors) {
  return `${selector} {\n${Object.entries(colors).map(([name, hex]) => `  --${name}: ${hex};`).join("\n")}\n}`;
}

/** The CSS that goes between the markers. */
function paletteCss(css) {
  return Object.entries(palettes(css))
    .map(([id, { light, dark }]) =>
      [block(`[data-accent="${id}"]`, light), block(`.dark[data-accent="${id}"],\n.dark [data-accent="${id}"]`, dark)].join("\n\n"),
    )
    .join("\n\n");
}

const css = readFileSync(FILE, "utf8");
const start = css.indexOf(BEGIN);
const end = css.indexOf(END);
if (start < 0 || end < start) throw new Error(`globals.css needs the two marker comments:\n${BEGIN}\n${END}`);

const generated = `\n${paletteCss(css)}\n`;
if (process.argv.includes("--check")) {
  if (css.slice(start + BEGIN.length, end).replace(/\r\n/g, "\n") !== generated) {
    console.error("The accent palettes in src/app/globals.css are out of date. Run: node scripts/generate-accent-palettes.mjs");
    process.exit(1);
  }
} else {
  // Keep the file's line endings (CRLF in a Windows checkout).
  const newline = css.includes("\r\n") ? "\r\n" : "\n";
  writeFileSync(FILE, css.slice(0, start + BEGIN.length) + generated.replace(/\n/g, newline) + css.slice(end));
  console.log("Wrote the accent palettes into src/app/globals.css.");
}
