import "server-only";

const APP_NAME = "AI-Multi Task-Management";
const RESEND_API_URL = "https://api.resend.com/emails";

type EmailProvider = "disabled" | "resend";

export type EmailDeliveryResult = {
  status: "disabled" | "sent" | "failed";
  message: string;
};

type ProjectInvitationEmailParams = {
  to: string;
  inviterName: string | null;
  inviterEmail: string;
  projectName: string;
  fallbackOrigin?: string;
};

type PasswordResetEmailParams = {
  to: string;
  resetUrl: string;
};

function cleanEnvValue(name: string) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : undefined;
}

function getEmailProvider(): EmailProvider | "invalid" {
  const provider = cleanEnvValue("EMAIL_PROVIDER")?.toLowerCase();
  if (!provider || provider === "disabled") return "disabled";
  if (provider === "resend") return "resend";
  return "invalid";
}

function getAppBaseUrl(fallbackOrigin?: string) {
  const configuredUrl = cleanEnvValue("APP_BASE_URL") || fallbackOrigin || "http://localhost:3000";
  return configuredUrl.replace(/\/+$/, "");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inviterLabel(name: string | null, email: string) {
  return name?.trim() ? `${name.trim()} (${email})` : email;
}

async function sendEmail({
  to,
  subject,
  text,
  html,
  successMessage,
  failureMessage,
  disabledMessage,
}: {
  to: string;
  subject: string;
  text: string;
  html: string;
  successMessage: string;
  failureMessage: string;
  disabledMessage: string;
}): Promise<EmailDeliveryResult> {
  const provider = getEmailProvider();

  if (provider === "disabled") {
    return { status: "disabled", message: disabledMessage };
  }

  if (provider === "invalid") {
    return { status: "failed", message: failureMessage };
  }

  const apiKey = cleanEnvValue("RESEND_API_KEY");
  const from = cleanEnvValue("EMAIL_FROM");

  if (!apiKey || !from) {
    return { status: "failed", message: failureMessage };
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, text, html }),
    });

    if (!response.ok) {
      console.warn("Email request failed.", { provider, status: response.status });
      return { status: "failed", message: failureMessage };
    }

    return { status: "sent", message: successMessage };
  } catch (error) {
    console.warn("Email request failed.", {
      provider,
      error: error instanceof Error ? error.message : "Unknown email error",
    });
    return { status: "failed", message: failureMessage };
  }
}

export async function sendProjectInvitationEmail({
  to,
  inviterName,
  inviterEmail,
  projectName,
  fallbackOrigin,
}: ProjectInvitationEmailParams): Promise<EmailDeliveryResult> {
  const invitationUrl = `${getAppBaseUrl(fallbackOrigin)}/signup?email=${encodeURIComponent(to)}`;
  const safeAppName = escapeHtml(APP_NAME);
  const safeInviter = escapeHtml(inviterLabel(inviterName, inviterEmail));
  const safeProjectName = escapeHtml(projectName);
  const safeInvitationUrl = escapeHtml(invitationUrl);

  const text = [
    `${APP_NAME} project invitation`,
    "",
    `${inviterLabel(inviterName, inviterEmail)} invited you to collaborate on ${projectName}.`,
    "",
    "Create an account or log in with this email address to accept or decline the invitation:",
    invitationUrl,
    "",
    "For your safety, this link does not automatically accept the invitation.",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #18181b;">
      <h1 style="font-size: 20px; margin: 0 0 16px;">${safeAppName} project invitation</h1>
      <p>${safeInviter} invited you to collaborate on <strong>${safeProjectName}</strong>.</p>
      <p>Create an account or log in with this email address to accept or decline the invitation.</p>
      <p>
        <a href="${safeInvitationUrl}" style="display: inline-block; padding: 10px 14px; border-radius: 8px; background: #2563eb; color: #ffffff; text-decoration: none;">
          Open invitation
        </a>
      </p>
      <p style="font-size: 13px; color: #52525b;">For your safety, this link does not automatically accept the invitation.</p>
    </div>
  `;

  return sendEmail({
    to,
    subject: `${APP_NAME}: invitation to ${projectName}`,
    text,
    html,
    successMessage: "Invitation created and email sent.",
    failureMessage: "Invitation created, but email could not be sent.",
    disabledMessage: "Invitation created. Email sending is not configured.",
  });
}


export async function sendPasswordResetEmail({ to, resetUrl }: PasswordResetEmailParams): Promise<EmailDeliveryResult> {
  const safeAppName = escapeHtml(APP_NAME);
  const safeResetUrl = escapeHtml(resetUrl);
  const text = [
    `${APP_NAME} password reset`,
    "",
    "Use this link to reset your password. It expires in 60 minutes:",
    resetUrl,
    "",
    "If you did not request a password reset, you can ignore this email.",
  ].join("\n");
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #18181b;">
      <h1 style="font-size: 20px; margin: 0 0 16px;">${safeAppName} password reset</h1>
      <p>Use this link to reset your password. It expires in 60 minutes.</p>
      <p><a href="${safeResetUrl}" style="display: inline-block; padding: 10px 14px; border-radius: 8px; background: #2563eb; color: #ffffff; text-decoration: none;">Reset password</a></p>
      <p style="font-size: 13px; color: #52525b;">If you did not request a password reset, you can ignore this email.</p>
    </div>
  `;

  return sendEmail({
    to,
    subject: `${APP_NAME}: reset your password`,
    text,
    html,
    successMessage: "If an account exists, a reset link was sent.",
    failureMessage: "If an account exists, a reset link was sent.",
    disabledMessage: "If an account exists, a reset link was sent.",
  });
}
