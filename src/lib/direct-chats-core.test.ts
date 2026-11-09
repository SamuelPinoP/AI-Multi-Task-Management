import assert from "node:assert/strict";
import test from "node:test";
import { directChatPair, displayName, initials, nameMatches, sharedProjectsLine, teammatesFrom } from "./direct-chats-core";

test("a pair of people has one chat, whoever writes first", () => {
  assert.deepEqual(directChatPair("b", "a"), { userAId: "a", userBId: "b" });
  assert.deepEqual(directChatPair("a", "b"), { userAId: "a", userBId: "b" });
});

test("names fall back to the email's local part", () => {
  assert.equal(displayName({ name: " Ana Torres ", email: "ana@example.com" }), "Ana Torres");
  assert.equal(displayName({ name: null, email: "maya@example.com" }), "maya");
  assert.equal(displayName({ name: "  ", email: "leo@example.com" }), "leo");
});

test("initials take the first two words", () => {
  assert.equal(initials("Ana Torres"), "AT");
  assert.equal(initials("maya"), "M");
  assert.equal(initials("Maria José de la Cruz"), "MJ");
  // Someone without a name shows as "@username" (#393): the @ is no initial.
  assert.equal(initials("@ana_t"), "A");
  assert.equal(initials("Ana - Torres"), "AT");
});

test("the shared projects read as a short line", () => {
  assert.equal(sharedProjectsLine([]), "");
  assert.equal(sharedProjectsLine(["Capstone"]), "In Capstone");
  assert.equal(sharedProjectsLine(["Capstone", "Sprint"]), "In Capstone and Sprint");
  assert.equal(sharedProjectsLine(["Capstone", "Sprint", "Job search", "Docs"]), "In Capstone, Sprint and 2 more");
});

test("teammates are everyone in your projects but you, once each, with the projects you share", () => {
  const people = teammatesFrom(
    [
      { name: "Capstone", people: [{ id: "me", name: "Sam", email: "sam@example.com" }, { id: "ana", name: "Ana Torres", email: "ana@example.com" }] },
      { name: "Sprint", people: [{ id: "ana", name: "Ana Torres", email: "ana@example.com" }, { id: "leo", name: null, email: "leo@example.com" }] },
    ],
    "me",
  );
  assert.deepEqual(people, [
    { id: "ana", name: "Ana Torres", projects: ["Capstone", "Sprint"] },
    { id: "leo", name: "leo", projects: ["Sprint"] },
  ]);
});

test("a search matches the starts of the name's words", () => {
  assert.equal(nameMatches("Ana Torres", "an"), true);
  assert.equal(nameMatches("Ana Torres", "tor"), true);
  assert.equal(nameMatches("Ana Torres", "ana to"), true);
  assert.equal(nameMatches("Ana Torres", "res"), false);
  assert.equal(nameMatches("Ana Torres", "leo"), false);
  assert.equal(nameMatches("Ana Torres", ""), true);
});
