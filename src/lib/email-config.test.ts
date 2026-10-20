import assert from "node:assert/strict";
import test from "node:test";
import { brevoPayload, parseEmailProvider, parseMailbox, smtpSettings } from "./email-config";

test("reads the email provider", () => {
  assert.equal(parseEmailProvider(undefined), "disabled");
  assert.equal(parseEmailProvider(" "), "disabled");
  assert.equal(parseEmailProvider("SMTP"), "smtp");
  assert.equal(parseEmailProvider("brevo"), "brevo");
  assert.equal(parseEmailProvider("resend"), "resend");
  assert.equal(parseEmailProvider("sendgrid"), "invalid");
});

test("parses sender mailboxes", () => {
  assert.deepEqual(parseMailbox("AI Tasks <tasks@example.com>"), { name: "AI Tasks", email: "tasks@example.com" });
  assert.deepEqual(parseMailbox('"Team, Inc" <team@example.com>'), { name: "Team, Inc", email: "team@example.com" });
  assert.deepEqual(parseMailbox("<a@example.com>"), { email: "a@example.com" });
  assert.deepEqual(parseMailbox(" a@example.com "), { email: "a@example.com" });
  assert.equal(parseMailbox("not an address"), null);
  assert.equal(parseMailbox(undefined), null);
});

test("SMTP defaults to Gmail over TLS on port 465", () => {
  assert.deepEqual(smtpSettings({ SMTP_USER: "app@gmail.com", SMTP_PASS: "abcd efgh ijkl mnop" }), {
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    user: "app@gmail.com",
    pass: "abcdefghijklmnop",
  });
});

test("SMTP keeps other providers' passwords as given and supports STARTTLS ports", () => {
  assert.deepEqual(
    smtpSettings({ SMTP_HOST: "smtp.example.com", SMTP_PORT: "587", SMTP_USER: "u", SMTP_PASS: "p a s s" }),
    { host: "smtp.example.com", port: 587, secure: false, user: "u", pass: "p a s s" },
  );
});

test("SMTP needs a login and a valid port", () => {
  assert.equal(smtpSettings({ SMTP_PASS: "x" }), null);
  assert.equal(smtpSettings({ SMTP_USER: "u" }), null);
  assert.equal(smtpSettings({ SMTP_USER: "u", SMTP_PASS: "p", SMTP_PORT: "abc" }), null);
  assert.equal(smtpSettings({ SMTP_USER: "u", SMTP_PASS: "p", SMTP_PORT: "70000" }), null);
});

test("builds Brevo's request body", () => {
  assert.deepEqual(
    brevoPayload(
      { name: "AI Tasks", email: "tasks@example.com" },
      { to: "you@example.com", subject: "Hi", text: "Hello", html: "<p>Hello</p>" },
    ),
    {
      sender: { name: "AI Tasks", email: "tasks@example.com" },
      to: [{ email: "you@example.com" }],
      subject: "Hi",
      textContent: "Hello",
      htmlContent: "<p>Hello</p>",
    },
  );
});
