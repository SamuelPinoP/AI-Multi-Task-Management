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

export async function sendProjectInvitationEmail({
  to,
  inviterName,
  inviterEmail,
  projectName,
  fallbackOrigin,
}: ProjectInvitationEmailParams): Promise<EmailDeliveryResult> {
  const provider = getEmailProvider();

  if (provider === "disabled") {
    return {
      status: "disabled",
      message: "Invitation created. Email sending is not configured.",
    };
  }

  if (provider === "invalid") {
    return {
      status: "failed",
      message: "Invitation created, but email could not be sent because EMAIL_PROVIDER is invalid.",
    };
  }

  const apiKey = cleanEnvValue("RESEND_API_KEY");
  const from = cleanEnvValue("EMAIL_FROM");

  if (!apiKey || !from) {
    return {
      status: "failed",
      message: "Invitation created, but email could not be sent because email configuration is incomplete.",
    };
  }

  const invitationUrl = `${getAppBaseUrl(fallbackOrigin)}/projects`;
  const safeAppName = escapeHtml(APP_NAME);
  const safeInviter = escapeHtml(inviterLabel(inviterName, inviterEmail));
  const safeProjectName = escapeHtml(projectName);
  const safeInvitationUrl = escapeHtml(invitationUrl);

  const text = [
    `${APP_NAME} project invitation`,
    "",
    `${inviterLabel(inviterName, inviterEmail)} invited you to collaborate on ${projectName}.`,
    "",
    "Log in to your account to accept or decline the invitation:",
    invitationUrl,
    "",
    "This email only includes the project name and inviter identity. Open the app to view invitation details.",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #18181b;">
      <h1 style="font-size: 20px; margin: 0 0 16px;">${safeAppName} project invitation</h1>
      <p>${safeInviter} invited you to collaborate on <strong>${safeProjectName}</strong>.</p>
      <p>Log in to your account to accept or decline the invitation.</p>
      <p>
        <a href="${safeInvitationUrl}" style="display: inline-block; padding: 10px 14px; border-radius: 8px; background: #2563eb; color: #ffffff; text-decoration: none;">
          View project invitations
        </a>
      </p>
      <p style="font-size: 13px; color: #52525b;">This email only includes the project name and inviter identity. Open the app to view invitation details.</p>
    </div>
  `;

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: `${APP_NAME}: invitation to ${projectName}`,
        text,
        html,
      }),
    });

    if (!response.ok) {
      console.warn("Project invitation email request failed.", {
        provider,
        status: response.status,
      });
      return {
        status: "failed",
        message: "Invitation created, but email could not be sent.",
      };
    }

    return {
      status: "sent",
      message: "Invitation created and email sent.",
    };
  } catch (error) {
    console.warn("Project invitation email request failed.", {
      provider,
      error: error instanceof Error ? error.message : "Unknown email error",
    });
    return {
      status: "failed",
      message: "Invitation created, but email could not be sent.",
    };
  }
}
