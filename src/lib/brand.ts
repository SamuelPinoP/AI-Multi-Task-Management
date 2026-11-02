/**
 * The AI Multi mark (DES-07, #292): the letters A and M in rounded strokes on
 * a teal tile, with a four-point spark as the A's crossbar. Drawn on a 48 x 48
 * grid. scripts/generate-app-icons.mjs draws the favicon and app icons from
 * the same paths, and brand.test.ts checks that they still match.
 */

/** The tile's teal. It stays the same in both themes, so the brand looks the same everywhere. */
export const BRAND_TEAL = "#0a6f68";

export const LOGO_LETTERS_PATH = "M8 35 L15.5 13 L23 35 M26.5 35 V13 L33.25 25 L40 13 V35";
export const LOGO_SPARK_PATH = "M15.5 23.2 Q16.1 27 19.8 27.6 Q16.1 28.2 15.5 32 Q14.9 28.2 11.2 27.6 Q14.9 27 15.5 23.2 Z";
export const LOGO_STROKE_WIDTH = 4.4;
