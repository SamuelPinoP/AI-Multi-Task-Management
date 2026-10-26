// The subject, plain text and HTML of every email the app sends, kept free of
// server-only imports so they can be unit tested. src/lib/email.ts sends them.
//
// Spam filters (#232) look for a complete HTML document next to a plain-text
// part, the same sender and content in both parts, few links, and a short note
// on who sent the email and why. Every email here goes through `htmlDocument`
// and `withFooter` to get those right.
import { invitationHref } from "./auth-links";
import { APP_NAME } from "./email-config";

export type EmailContent = { subject: string; text: string; html: string };

const BUTTON_STYLE = "display: inline-block; padding: 10px 14px; border-radius: 8px; color: #ffffff; text-decoration: none;";

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Names are free text; a subject must stay on one line. */
function oneLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function footer(reason: string) {
  return `Sent by ${APP_NAME}. ${reason}`;
}

function withFooter(lines: string[], reason: string) {
  return [...lines, "", "---", footer(reason)].join("\n");
}

function button(label: string, url: string, color = "#2563eb") {
  return `<p><a href="${escapeHtml(url)}" style="${BUTTON_STYLE} background: ${color};">${escapeHtml(label)}</a></p>`;
}

/** A complete HTML document: doctype, language, charset and title, then the body and footer. */
function htmlDocument(subject: string, body: string, reason: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 24px; background: #ffffff;">
<div style="max-width: 560px; margin: 0 auto; font-family: Arial, sans-serif; line-height: 1.5; color: #18181b;">
${body.trim()}
<hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0 12px;">
<p style="font-size: 12px; color: #71717a; margin: 0;">${escapeHtml(footer(reason))}</p>
</div>
</body>
</html>
`;
}

function inviterLabel(name: string | null, email: string) {
  return name?.trim() ? `${name.trim()} (${email})` : email;
}

export function projectInvitationEmail({
  to,
  inviterName,
  inviterEmail,
  projectName,
  hasAccount,
  baseUrl,
}: {
  to: string;
  inviterName: string | null;
  inviterEmail: string;
  projectName: string;
  /** Whether `to` already has an account: the link opens log in instead of sign up. */
  hasAccount: boolean;
  baseUrl: string;
}): EmailContent {
  // Only the invitee reads this email, so choosing the page by whether the
  // address has an account tells the inviter nothing.
  const invitationUrl = `${baseUrl}${invitationHref(to, hasAccount)}`;
  // In case they made an account after the invitation was sent.
  const loginUrl = `${baseUrl}${invitationHref(to, true)}`;
  const inviter = inviterLabel(inviterName, inviterEmail);
  const instruction = hasAccount
    ? "Log in with this email address to accept or decline the invitation"
    : "Create an account with this email address to accept or decline the invitation";
  const safety = `For your safety, ${hasAccount ? "this link does" : "these links do"} not automatically accept the invitation.`;
  const reason = `You're getting this because ${inviter} invited this address to a project.`;
  const subject = `${APP_NAME}: invitation to ${oneLine(projectName)}`;

  const text = withFooter(
    [
      `${APP_NAME} project invitation`,
      "",
      `${inviter} invited you to collaborate on ${projectName}.`,
      "",
      `${instruction}:`,
      invitationUrl,
      ...(hasAccount ? [] : ["", "Already have an account? Log in instead:", loginUrl]),
      "",
      safety,
    ],
    reason,
  );

  const html = htmlDocument(
    subject,
    `
<h1 style="font-size: 20px; margin: 0 0 16px;">${escapeHtml(APP_NAME)} project invitation</h1>
<p>${escapeHtml(inviter)} invited you to collaborate on <strong>${escapeHtml(projectName)}</strong>.</p>
<p>${instruction}.</p>
${button(hasAccount ? "Log in to respond" : "Create your account", invitationUrl)}
${hasAccount ? "" : `<p>Already have an account? <a href="${escapeHtml(loginUrl)}" style="color: #2563eb;">Log in instead</a>.</p>`}
<p style="font-size: 13px; color: #52525b;">${safety}</p>
`,
    reason,
  );

  return { subject, text, html };
}

export function passwordResetEmail({ resetUrl }: { resetUrl: string }): EmailContent {
  const subject = `${APP_NAME}: reset your password`;
  const reason = "You're getting this because someone asked to reset the password of the account with this address.";
  const text = withFooter(
    [
      `${APP_NAME} password reset`,
      "",
      "Use this link to reset your password. It expires in 60 minutes:",
      resetUrl,
      "",
      "If you did not request a password reset, you can ignore this email.",
    ],
    reason,
  );
  const html = htmlDocument(
    subject,
    `
<h1 style="font-size: 20px; margin: 0 0 16px;">${escapeHtml(APP_NAME)} password reset</h1>
<p>Use this link to reset your password. It expires in 60 minutes.</p>
${button("Reset password", resetUrl)}
<p style="font-size: 13px; color: #52525b;">If you did not request a password reset, you can ignore this email.</p>
`,
    reason,
  );
  return { subject, text, html };
}

/** "Confirm your email" with a link that proves the user owns the address (#130). */
export function emailVerificationEmail({ verifyUrl }: { verifyUrl: string }): EmailContent {
  const subject = `${APP_NAME}: confirm your email`;
  const reason = "You're getting this because this address was used to sign up.";
  const text = withFooter(
    [
      `Confirm your email for ${APP_NAME}`,
      "",
      "Open this link to confirm this is your email address. It expires in 24 hours:",
      verifyUrl,
      "",
      "You need a confirmed email to join projects you're invited to.",
      "If you didn't create an account, you can ignore this email.",
    ],
    reason,
  );
  const html = htmlDocument(
    subject,
    `
<h1 style="font-size: 20px; margin: 0 0 16px;">Confirm your email for ${escapeHtml(APP_NAME)}</h1>
<p>Confirm this is your email address. The link expires in 24 hours.</p>
${button("Confirm email", verifyUrl)}
<p>You need a confirmed email to join projects you're invited to.</p>
<p style="font-size: 13px; color: #52525b;">If you didn't create an account, you can ignore this email.</p>
`,
    reason,
  );
  return { subject, text, html };
}

/** A project automation's "email the owner" message (SMART-11). */
export function taskAutomationEmail({
  trigger,
  taskTitle,
  projectId,
  projectName,
  actorName,
  baseUrl,
}: {
  trigger: "TASK_CREATED" | "TASK_COMPLETED";
  taskTitle: string;
  projectId: string;
  projectName: string;
  actorName: string;
  baseUrl: string;
}): EmailContent {
  const projectUrl = `${baseUrl}/projects/${encodeURIComponent(projectId)}`;
  const happened = trigger === "TASK_COMPLETED" ? "marked a task as done" : "added a task";
  const subject = `${APP_NAME}: ${trigger === "TASK_COMPLETED" ? "Done in" : "New task in"} ${oneLine(projectName)}: ${oneLine(taskTitle)}`;
  const reason = "You're getting this because an automation on the project is on. The project owner can turn it off on the project page.";
  const text = withFooter(
    [`${actorName} ${happened} in ${projectName}:`, "", taskTitle, "", `Open the project: ${projectUrl}`],
    reason,
  );
  const html = htmlDocument(
    subject,
    `
<p>${escapeHtml(actorName)} ${happened} in <strong>${escapeHtml(projectName)}</strong>:</p>
<p style="font-size: 16px; font-weight: bold; margin: 0 0 16px;">${escapeHtml(taskTitle)}</p>
${button("Open the project", projectUrl, "#0a6f68")}
`,
    reason,
  );
  return { subject, text, html };
}
