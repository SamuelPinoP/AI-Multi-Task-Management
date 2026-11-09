import assert from "node:assert/strict";
import test from "node:test";
import { canChangeRole, canManageMembers, canRemoveMember, memberRole, parseAssignableRole, PROJECT_ROLE_LABELS } from "./project-roles";

test("member rows read as admins or editors; an Owner row would be an editor", () => {
  assert.equal(memberRole("ADMIN"), "ADMIN");
  assert.equal(memberRole("EDITOR"), "EDITOR");
  assert.equal(memberRole("OWNER"), "EDITOR");
});

test("requests can ask for Admin or Editor, never Viewer", () => {
  assert.equal(parseAssignableRole("ADMIN"), "ADMIN");
  assert.equal(parseAssignableRole("EDITOR"), "EDITOR");
  assert.equal(parseAssignableRole(undefined), "EDITOR");
  assert.equal(parseAssignableRole(""), "EDITOR");
  assert.equal(parseAssignableRole(undefined, { required: true }), null);
  assert.equal(parseAssignableRole("VIEWER"), null);
  assert.equal(parseAssignableRole("OWNER"), null);
  assert.equal(parseAssignableRole("admin"), null);
  assert.equal(parseAssignableRole(1), null);
});

test("the owner and admins manage people; editors and outsiders don't", () => {
  assert.equal(canManageMembers("OWNER"), true);
  assert.equal(canManageMembers("ADMIN"), true);
  assert.equal(canManageMembers("EDITOR"), false);
  assert.equal(canManageMembers(null), false);
});

test("admins remove editors; only the owner removes an admin", () => {
  assert.equal(canRemoveMember("OWNER", "ADMIN"), true);
  assert.equal(canRemoveMember("OWNER", "EDITOR"), true);
  assert.equal(canRemoveMember("ADMIN", "EDITOR"), true);
  assert.equal(canRemoveMember("ADMIN", "ADMIN"), false);
  assert.equal(canRemoveMember("EDITOR", "EDITOR"), false);
  assert.equal(canRemoveMember(null, "EDITOR"), false);
});

test("admins make editors admins; only the owner dismisses an admin", () => {
  assert.equal(canChangeRole("ADMIN", "EDITOR", "ADMIN"), true);
  assert.equal(canChangeRole("ADMIN", "ADMIN", "EDITOR"), false);
  assert.equal(canChangeRole("OWNER", "ADMIN", "EDITOR"), true);
  assert.equal(canChangeRole("OWNER", "EDITOR", "ADMIN"), true);
  assert.equal(canChangeRole("EDITOR", "EDITOR", "ADMIN"), false);
  assert.equal(canChangeRole(undefined, "EDITOR", "ADMIN"), false);
});

test("roles read as words", () => {
  assert.deepEqual(PROJECT_ROLE_LABELS, { OWNER: "Owner", ADMIN: "Admin", EDITOR: "Member" });
});
