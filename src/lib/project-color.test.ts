import assert from "node:assert/strict";
import test from "node:test";
import { paletteColor, projectColor } from "./project-color";

test("a project keeps its own color", () => {
  assert.equal(projectColor({ id: "p1", color: "#ff0000" }), "#ff0000");
});

test("projects without a color get a stable palette color", () => {
  const color = projectColor({ id: "cmabc123", color: null });
  assert.match(color, /^var\(--project-[1-4]\)$/);
  assert.equal(projectColor({ id: "cmabc123", color: "" }), color);
  assert.equal(paletteColor("cmabc123"), color);
});

test("palette colors spread across ids", () => {
  const colors = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(paletteColor));
  assert.ok(colors.size > 1);
});
