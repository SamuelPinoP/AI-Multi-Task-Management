import assert from "node:assert/strict";
import test from "node:test";
import {
  emailVerificationEmail,
  newAccountEmail,
  passwordResetEmail,
  projectInvitationEmail,
  type EmailContent,
} from "./email-templates";

const baseUrl = "https://app.example.com";

const emails: [string, EmailContent][] = [
  ["verification", emailVerificationEmail({ verifyUrl: `${baseUrl}/verify-email?token=abc` })],
  ["password reset", passwordResetEmail({ resetUrl: `${baseUrl}/reset-password?token=abc` })],
  [
    "invitation, new account",
    projectInvitationEmail({ to: "new@example.com", inviterName: "Dana", inviterEmail: "dana@example.com", projectName: "Capstone", hasAccount: false, baseUrl }),
  ],
  [
    "invitation, existing account",
    projectInvitationEmail({ to: "old@example.com", inviterName: null, inviterEmail: "dana@example.com", projectName: "Capstone", hasAccount: true, baseUrl }),
  ],
  [
    "new account",
    newAccountEmail({ name: "Dana Reyes", username: "dana", email: "dana@example.com", method: "password", userUrl: `${baseUrl}/users/cm123` }),
  ],
];

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1].replace(/&amp;/g, "&"));

test("every email is a complete HTML document titled with its subject", () => {
  for (const [name, email] of emails) {
    assert.match(email.html, /^<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">/, name);
    assert.ok(email.html.includes(`<title>${email.subject}</title>`), `${name}: title`);
    assert.match(email.html, /<body[^>]*>[\s\S]*<\/body>\n<\/html>\n$/, name);
  }
});

test("every email has a plain-text part with the same links as the HTML", () => {
  for (const [name, email] of emails) {
    assert.ok(email.text.trim().length > 0, `${name}: text part`);
    const links = hrefs(email.html);
    assert.ok(links.length >= 1 && links.length <= 2, `${name}: ${links.length} links`);
    for (const link of links) assert.ok(email.text.includes(link), `${name}: text part lacks ${link}`);
  }
});

test("every email says who sent it and why, in both parts", () => {
  for (const [name, email] of emails) {
    const reason = /Sent by AI Multi\. You're getting this because [^\n]+/.exec(email.text)?.[0];
    assert.ok(reason, `${name}: footer in the text part`);
    assert.ok(email.html.includes(reason.replace(/'/g, "&#39;")), `${name}: same footer in the HTML`);
  }
});

test("subjects start with the app name and stay on one line", () => {
  for (const [name, email] of emails) {
    assert.match(email.subject, /^AI Multi: /, name);
    assert.ok(!/[\r\n]/.test(email.subject), name);
  }
  const multiline = projectInvitationEmail({
    to: "new@example.com",
    inviterName: "Dana",
    inviterEmail: "dana@example.com",
    projectName: "Cap\r\nstone\nlaunch",
    hasAccount: false,
    baseUrl,
  });
  assert.equal(multiline.subject, "AI Multi: invitation to Cap stone launch");
});

test("names from users are escaped in the HTML", () => {
  const email = projectInvitationEmail({
    to: "new@example.com",
    inviterName: '<img src=x onerror="alert(1)">',
    inviterEmail: "dana@example.com",
    projectName: "<script>alert(1)</script>",
    hasAccount: false,
    baseUrl,
  });
  assert.ok(!email.html.includes("<script>"));
  assert.ok(!email.html.includes("<img"));
  assert.ok(email.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(email.html.includes("<title>AI Multi: invitation to &lt;script&gt;alert(1)&lt;/script&gt;</title>"));
});

test("a new account email says who signed up, how, and links to their page (#429)", () => {
  const [, email] = emails[4];
  assert.equal(email.subject, "AI Multi: new account, Dana Reyes");
  assert.ok(email.text.startsWith("Dana Reyes signed up with a password.\n"));
  for (const line of ["Name: Dana Reyes", "Username: @dana", "Email: dana@example.com"]) {
    assert.ok(email.text.includes(line), line);
    assert.ok(email.html.includes(line), `HTML: ${line}`);
  }
  assert.deepEqual(hrefs(email.html), [`${baseUrl}/users/cm123`]);

  const google = newAccountEmail({ name: null, username: null, email: "pat@example.org", method: "google", userUrl: `${baseUrl}/users/cm456` });
  assert.equal(google.subject, "AI Multi: new account, pat@example.org");
  assert.ok(google.text.includes("pat@example.org signed up with Google."));
  assert.ok(google.text.includes("Name: (none)"));
  assert.ok(google.text.includes("Username: (none yet)"));

  // A name is free text: one line in the subject, escaped in the HTML.
  const odd = newAccountEmail({ name: "<b>Eve</b>\r\nBcc: x@example.com", username: "eve", email: "eve@example.com", method: "password", userUrl: `${baseUrl}/users/cm789` });
  assert.equal(odd.subject, "AI Multi: new account, <b>Eve</b> Bcc: x@example.com");
  assert.ok(!odd.html.includes("<b>Eve</b>"));
  assert.ok(odd.html.includes("&lt;b&gt;Eve&lt;/b&gt;"));
});

test("an invitation to a new address also offers log in", () => {
  const [, newAccount] = emails[2];
  const [, existingAccount] = emails[3];
  assert.equal(hrefs(newAccount.html).length, 2);
  assert.ok(newAccount.text.includes("Already have an account? Log in instead:"));
  assert.equal(hrefs(existingAccount.html).length, 1);
  assert.ok(!existingAccount.text.includes("Already have an account?"));
});
