import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMATION_RECIPES,
  automaticAssignee,
  describeAutomation,
  parseAutomationInput,
  shouldEmailOwner,
} from "./project-automations-core";

test("only the listed trigger and action pairs are accepted", () => {
  assert.deepEqual(parseAutomationInput({ trigger: "TASK_COMPLETED", action: "EMAIL_OWNER" }), {
    trigger: "TASK_COMPLETED",
    action: "EMAIL_OWNER",
    memberId: null,
  });
  assert.ok("error" in parseAutomationInput({ trigger: "TASK_COMPLETED", action: "ASSIGN_MEMBER", memberId: "m1" }));
  assert.ok("error" in parseAutomationInput({ trigger: "TASK_DELETED", action: "EMAIL_OWNER" }));
  assert.ok("error" in parseAutomationInput(null));
  assert.ok("error" in parseAutomationInput("TASK_CREATED"));
});

test("assigning needs a member, and other rules drop one", () => {
  assert.deepEqual(parseAutomationInput({ trigger: "TASK_CREATED", action: "ASSIGN_MEMBER" }), { error: "Choose who gets new tasks." });
  assert.deepEqual(parseAutomationInput({ trigger: "TASK_CREATED", action: "ASSIGN_MEMBER", memberId: " m1 " }), {
    trigger: "TASK_CREATED",
    action: "ASSIGN_MEMBER",
    memberId: "m1",
  });
  assert.equal(
    (parseAutomationInput({ trigger: "TASK_CREATED", action: "EMAIL_OWNER", memberId: "m1" }) as { memberId: string | null }).memberId,
    null,
  );
});

test("rules read as sentences", () => {
  assert.equal(describeAutomation({ trigger: "TASK_COMPLETED", action: "EMAIL_OWNER" }), AUTOMATION_RECIPES[0].label);
  assert.equal(
    describeAutomation({ trigger: "TASK_CREATED", action: "ASSIGN_MEMBER", memberName: "Alex" }),
    "When a task is added without an assignee, assign it to Alex",
  );
});

test("owners aren't emailed about their own changes, and guests never", () => {
  assert.equal(shouldEmailOwner({ id: "owner", isGuest: false }, "editor"), true);
  assert.equal(shouldEmailOwner({ id: "owner", isGuest: false }, "owner"), false);
  assert.equal(shouldEmailOwner({ id: "owner", isGuest: true }, "editor"), false);
});

test("the assign rule fills only an empty assignee on a top-level task", () => {
  const rules = [
    { trigger: "TASK_CREATED" as const, action: "ASSIGN_MEMBER" as const, enabled: false, memberId: "off" },
    { trigger: "TASK_CREATED" as const, action: "EMAIL_OWNER" as const, enabled: true, memberId: null },
    { trigger: "TASK_CREATED" as const, action: "ASSIGN_MEMBER" as const, enabled: true, memberId: "alex" },
  ];
  assert.equal(automaticAssignee(rules, { assigneeId: null, isSubtask: false }), "alex");
  assert.equal(automaticAssignee(rules, { assigneeId: "sam", isSubtask: false }), "sam");
  assert.equal(automaticAssignee(rules, { assigneeId: null, isSubtask: true }), null);
  assert.equal(automaticAssignee(rules.slice(0, 2), { assigneeId: null, isSubtask: false }), null);
});
