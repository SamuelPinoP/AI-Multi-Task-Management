import assert from "node:assert/strict";
import test from "node:test";
import { AVATAR_COLORS, avatarColor, paletteColor, projectColor } from "./project-color";

test("a project keeps its own color", () => {
  assert.equal(projectColor({ id: "p1", color: "#ff0000" }), "#ff0000");
});

test("projects without a color get a stable palette color", () => {
  const color = projectColor({ id: "cmabc123", color: null });
  assert.match(color, /^var\(--project-[1-4]\)$/);
  assert.equal(projectColor({ id: "cmabc123", color: "" }), color);
  assert.equal(paletteColor("cmabc123"), color);
});

test("white initials pass WCAG AA on every avatar color", () => {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  for (const color of AVATAR_COLORS) assert.ok(1.05 / (luminance(color) + 0.05) >= 4.5, color);
  assert.equal(avatarColor("cmabc123"), avatarColor("cmabc123"));
  assert.ok(new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(avatarColor)).size > 1);
});

test("palette colors spread across ids", () => {
  const colors = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(paletteColor));
  assert.ok(colors.size > 1);
});
