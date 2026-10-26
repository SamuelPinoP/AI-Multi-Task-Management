import assert from "node:assert/strict";
import test from "node:test";
import {
  emailVerificationEmail,
  passwordResetEmail,
  projectInvitationEmail,
  taskAutomationEmail,
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
    "task automation",
    taskAutomationEmail({ trigger: "TASK_COMPLETED", taskTitle: "Draft slides", projectId: "p1", projectName: "Capstone", actorName: "Dana", baseUrl }),
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
  const multiline = taskAutomationEmail({
    trigger: "TASK_CREATED",
    taskTitle: "Line one\nLine two",
    projectId: "p1",
    projectName: "Cap\r\nstone",
    actorName: "Dana",
    baseUrl,
  });
  assert.equal(multiline.subject, "AI Multi: New task in Cap stone: Line one Line two");
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

test("an invitation to a new address also offers log in", () => {
  const [, newAccount] = emails[2];
  const [, existingAccount] = emails[3];
  assert.equal(hrefs(newAccount.html).length, 2);
  assert.ok(newAccount.text.includes("Already have an account? Log in instead:"));
  assert.equal(hrefs(existingAccount.html).length, 1);
  assert.ok(!existingAccount.text.includes("Already have an account?"));
});
