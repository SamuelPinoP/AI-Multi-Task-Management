import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanLabelName,
  isLabelColor,
  LABEL_COLORS,
  LABEL_NAME_MAX,
  labelColorName,
  labelNameKey,
  labelsOfTask,
  matchesLabelFilter,
  nextLabelColor,
  sortLabels,
} from "./labels";

test("label names are trimmed, spaces collapsed, and capped", () => {
  assert.equal(cleanLabelName("  needs   review "), "needs review");
  assert.equal(cleanLabelName("x".repeat(LABEL_NAME_MAX)), "x".repeat(LABEL_NAME_MAX));
  assert.equal(cleanLabelName("x".repeat(LABEL_NAME_MAX + 1)), null);
  assert.equal(cleanLabelName("   "), null);
  assert.equal(cleanLabelName(42), null);
});

test("names compare ignoring case and spacing", () => {
  assert.equal(labelNameKey("Bug"), labelNameKey(" bug "));
  assert.equal(labelNameKey("Needs  Review"), "needs review");
  assert.notEqual(labelNameKey("bug"), labelNameKey("bugs"));
});

test("only palette colors are allowed", () => {
  for (const color of LABEL_COLORS) assert.equal(isLabelColor(color.value), true);
  assert.equal(isLabelColor("#0F9488"), true);
  assert.equal(isLabelColor("#123456"), false);
  assert.equal(isLabelColor("red"), false);
  assert.equal(isLabelColor(undefined), false);
  assert.equal(labelColorName("#2563EB"), "Blue");
});

test("new labels take the first free color, then go round again", () => {
  assert.equal(nextLabelColor([]), LABEL_COLORS[0].value);
  assert.equal(nextLabelColor([LABEL_COLORS[0].value, LABEL_COLORS[1].value]), LABEL_COLORS[2].value);
  assert.equal(nextLabelColor([LABEL_COLORS[1].value]), LABEL_COLORS[0].value);
  const all = LABEL_COLORS.map((color) => color.value);
  assert.equal(nextLabelColor(all), LABEL_COLORS[all.length % LABEL_COLORS.length].value);
  assert.equal(nextLabelColor([...all, LABEL_COLORS[0].value]), LABEL_COLORS[1].value);
});

test("the filter matches tasks with any chosen label, and everything when none is chosen", () => {
  assert.equal(matchesLabelFilter(["a"], new Set()), true);
  assert.equal(matchesLabelFilter([], new Set()), true);
  assert.equal(matchesLabelFilter(["a", "b"], new Set(["b", "c"])), true);
  assert.equal(matchesLabelFilter(["a"], new Set(["c"])), false);
  assert.equal(matchesLabelFilter([], new Set(["c"])), false);
});

test("a task's labels come out of the join rows sorted by name", () => {
  const label = (id: string, name: string) => ({ label: { id, name, color: "#0f9488", projectId: null } });
  assert.deepEqual(
    labelsOfTask({ labels: [label("2", "design"), label("1", "Bug"), label("3", "backend")] }).map((item) => item.name),
    ["backend", "Bug", "design"],
  );
  assert.deepEqual(labelsOfTask({}), []);
  assert.deepEqual(sortLabels([{ name: "b" }, { name: "A" }]).map((item) => item.name), ["A", "b"]);
});
