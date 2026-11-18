import assert from "node:assert/strict";
import test from "node:test";
import { AI_DOCKS, aiDockFromStored, aiDockRequestSchema, aiDockToStored } from "./dock";

test("an account that never chose gets the bar", () => {
  assert.equal(aiDockFromStored(null), "open");
  assert.equal(aiDockFromStored(undefined), "open");
});

test("each state is saved and read back as itself", () => {
  for (const dock of AI_DOCKS) assert.equal(aiDockFromStored(aiDockToStored(dock)), dock);
  assert.deepEqual(AI_DOCKS.map(aiDockToStored), ["OPEN", "MINIMIZED", "HIDDEN"]);
});

test("the endpoint takes only the three states, and nothing else", () => {
  assert.deepEqual(aiDockRequestSchema.parse({ dock: "hidden" }), { dock: "hidden" });
  for (const body of [{ dock: "HIDDEN" }, { dock: "closed" }, { dock: "open", userId: "someone" }, {}, null, "open"]) {
    assert.equal(aiDockRequestSchema.safeParse(body).success, false, JSON.stringify(body));
  }
});
