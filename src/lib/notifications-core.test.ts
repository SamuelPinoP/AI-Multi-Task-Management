import assert from "node:assert/strict";
import test from "node:test";
import { dueSoonNotifications, isValidPushSubscription, mentionedUserIds, pushPayload } from "./notifications-core";

const people = [
  { userId: "ana", name: "Ana Pérez", email: "ana.p@example.com" },
  { userId: "bo", name: "Bo", email: "bo@example.com" },
  { userId: "sam", name: null, email: "sam.lee@example.com" },
  { userId: "anabel", name: "Anabel Ruiz", email: "anabel@example.com" },
];

test("mentions match @full name, @first name or @email name, in any case", () => {
  assert.deepEqual(mentionedUserIds("Thanks @Ana Pérez!", people), ["ana"]);
  assert.deepEqual(mentionedUserIds("@ana can you look?", people), ["ana"]);
  assert.deepEqual(mentionedUserIds("ping @sam.lee and @BO.", people), ["bo", "sam"]);
});

test("a mention has to end where the name ends", () => {
  assert.deepEqual(mentionedUserIds("@anabel has it", people), ["anabel"]);
  assert.deepEqual(mentionedUserIds("email ana@example.com, no mention", people), []);
  assert.deepEqual(mentionedUserIds("@bob isn't Bo", people), []);
  assert.deepEqual(mentionedUserIds("no at signs here, Ana", people), []);
});

test("names split over spaces and line breaks still match", () => {
  assert.deepEqual(mentionedUserIds("hey @ana\npérez", people), ["ana"]);
});

test("due-soon reminders go to the assignee, else the owner, once per task and due date", () => {
  const now = new Date("2026-10-22T13:00:00.000Z");
  const task = { title: "Report", ownerId: "owner", projectName: "Launch" };
  const reminders = dueSoonNotifications(
    [
      { ...task, id: "t1", dueDate: new Date("2026-10-22T00:00:00.000Z"), assigneeUserId: "ana" },
      { ...task, id: "t2", dueDate: new Date("2026-10-23T00:00:00.000Z"), assigneeUserId: null, projectName: null },
      { ...task, id: "t3", dueDate: new Date("2026-10-24T00:00:00.000Z"), assigneeUserId: null },
      { ...task, id: "t4", dueDate: new Date("2026-10-21T00:00:00.000Z"), assigneeUserId: null },
    ],
    now,
  );
  assert.deepEqual(reminders, [
    { userId: "ana", type: "TASK_DUE_SOON", title: "Due today: Report", body: "In Launch", url: "/tasks?task=t1", dedupeKey: "due:t1:2026-10-22" },
    { userId: "owner", type: "TASK_DUE_SOON", title: "Due tomorrow: Report", body: null, url: "/tasks?task=t2", dedupeKey: "due:t2:2026-10-23" },
  ]);
});

test("the push payload is what the service worker reads", () => {
  assert.deepEqual(JSON.parse(pushPayload({ id: "n1", title: "Hi", body: null, url: null })), { title: "Hi", body: "", url: "/", tag: "n1" });
});

test("push subscriptions must be https push services with base64url keys", () => {
  const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
  assert.equal(isValidPushSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys }), true);
  assert.equal(isValidPushSubscription({ endpoint: "http://fcm.googleapis.com/fcm/send/abc", keys }), false);
  assert.equal(isValidPushSubscription({ endpoint: "not a url", keys }), false);
  assert.equal(isValidPushSubscription({ endpoint: "https://push.example/abc", keys: { ...keys, auth: "bad key!" } }), false);
  assert.equal(isValidPushSubscription(null), false);
});
