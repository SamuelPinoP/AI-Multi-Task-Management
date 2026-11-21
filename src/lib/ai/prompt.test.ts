import assert from "node:assert/strict";
import test from "node:test";
import { systemPrompt } from "./prompt";

test("the prompt dates today in the person's time zone, for the dates the model works out (#310)", () => {
  // 3:30 PM UTC on Thursday: Friday has begun in Tokyo, while it's Thursday morning in Los Angeles.
  const realNow = new Date("2026-11-19T15:30:00.000Z");
  assert.match(systemPrompt({ realNow, timeZone: "Asia/Tokyo" }), /It is Friday, November 20, 2026.* \(2026-11-20\) in the person's time zone, Asia\/Tokyo\./);
  assert.match(systemPrompt({ realNow, timeZone: "America/Los_Angeles" }), /It is Thursday, November 19, 2026.* \(2026-11-19\) in the person's time zone, America\/Los_Angeles\./);
  assert.match(systemPrompt({ realNow, timeZone: null }), /\(2026-11-19\) in the person's time zone, UTC\./);
  assert.match(systemPrompt({ realNow, timeZone: null }), /"tomorrow at 3" is tomorrow's date at 15:00/);
});
