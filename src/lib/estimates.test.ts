import assert from "node:assert/strict";
import { test } from "node:test";
import { AI_ESTIMATE, ESTIMATE_STEPS, SPLIT_OVER, aiEstimateLine, descriptionEstimate, hasEstimate, isEstimateSection, ownEstimate, parseDuration, stepMinutes } from "./estimates";

test("the steps run from 15 minutes to a week, a day being 8 hours of work and a week 5 days", () => {
  assert.deepEqual(
    ESTIMATE_STEPS.map(stepMinutes),
    [15, 30, 60, 120, 240, 480, 960, 1440, 2400],
  );
  // Over 2 days is worth splitting: 3 days and a week are, 2 days isn't.
  assert.deepEqual(
    ESTIMATE_STEPS.filter((step) => stepMinutes(step) > SPLIT_OVER),
    ["3 days", "1 week"],
  );
});

test("an amount of time reads in minutes, the way people write it", () => {
  const cases: Array<[string, number | null]> = [
    ["15 min", 15],
    ["90 minutes", 90],
    ["4 h", 240],
    ["4h", 240],
    ["1.5 hours", 90],
    ["1,5 hrs", 90],
    ["1 day", 480],
    ["2 days", 960],
    ["1 week", 2400],
    ["2 wks", 4800],
    ["**4 h** · AI estimate", 240],
    ["About 3 days, maybe 4 days", 1440],
    // Numbers that aren't time, before the time.
    ["2 tests and 30 min of review", 30],
    ["Pack the kitchen", null],
    ["v2 h", null],
    ["", null],
  ];
  for (const [text, minutes] of cases) assert.equal(parseDuration(text), minutes, text);
});

test("the AI's estimate is marked as its own, and read back from the Estimate section", () => {
  assert.equal(aiEstimateLine("4 h"), `**4 h** · ${AI_ESTIMATE}`);

  const ticket = `## Summary\n\nSign in with a code.\n\n## Estimate\n\n${aiEstimateLine("3 days")}\nAn app, a code at sign-in and recovery codes.\n\n## Original request\n\n> Add two-step sign-in`;
  assert.deepEqual(descriptionEstimate(ticket), { minutes: 1440, ai: true });
  // A person's estimate, under a title in any case.
  assert.deepEqual(descriptionEstimate("## estimate\n\n6 h, with the review."), { minutes: 360, ai: false });
  // None: no section, a section with no time on its first line, or no description.
  assert.equal(descriptionEstimate("## Summary\n\nIt takes 2 h."), null);
  assert.equal(descriptionEstimate("## Estimate\n\nNot sure yet."), null);
  assert.equal(descriptionEstimate("## Estimate\n\nHard to say\nMore than 2 days of work: worth splitting into subtasks."), null);
  assert.equal(descriptionEstimate("Plain text, 2 h"), null);
  assert.equal(descriptionEstimate(null), null);

  assert.equal(isEstimateSection(" ESTIMATE "), true);
  assert.equal(isEstimateSection("Estimates"), false);
});

test("a person who changes the estimate makes it theirs; saved unchanged, it stays the AI's", () => {
  const ai = `${aiEstimateLine("4 h")}\nA counter and two tests.`;
  assert.equal(ownEstimate(ai, ai.replace("4 h", "6 h")), "**6 h**\nA counter and two tests.");
  // Changing only the reason makes it theirs too.
  assert.equal(ownEstimate(ai, `${aiEstimateLine("4 h")}\nA counter, two tests and a review.`), "**4 h**\nA counter, two tests and a review.");
  assert.equal(ownEstimate(ai, `${ai}\n`), `${ai}\n`);
  // One that was already theirs is left as they wrote it.
  assert.equal(ownEstimate("6 h", "1 day"), "1 day");
});

test("a task has an estimate when its Estimate section says something, in the AI's words or a person's", () => {
  assert.equal(hasEstimate(`## Estimate\n\n${aiEstimateLine("2 h")}\nTwo screens.`), true);
  assert.equal(hasEstimate("Before the club meets.\n\n## estimate\n\nAbout a week of evenings"), true);
  assert.equal(hasEstimate("## Estimate\n\n## Notes\n\nNone yet."), false, "an empty section");
  assert.equal(hasEstimate("It takes 2 h"), false, "a plain description");
  assert.equal(hasEstimate(""), false);
  assert.equal(hasEstimate(null), false);
});
