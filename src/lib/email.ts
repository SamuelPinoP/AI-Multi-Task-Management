import "server-only";
import {
  brevoPayload,
  parseEmailProvider,
  parseMailbox,
  smtpSender,
  smtpSettings,
  type EmailProvider,
  type OutgoingEmail,
} from "@/lib/email-config";
import {
  emailVerificationEmail,
  passwordResetEmail,
  projectInvitationEmail,
  taskAutomationEmail,
  type EmailContent,
} from "@/lib/email-templates";

const RESEND_API_URL = "https://api.resend.com/emails";
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
// Vercel functions have short time limits; give up on a slow mail server.
const SMTP_TIMEOUT_MS = 10_000;

export type EmailDeliveryResult = {
  status: "disabled" | "sent" | "failed";
  message: string;
};

type ProjectInvitationEmailParams = {
  to: string;
  inviterName: string | null;
  inviterEmail: string;
  projectName: string;
  /** Whether `to` already has an account: the link opens log in instead of sign up. */
  hasAccount: boolean;
  fallbackOrigin?: string;
};

type PasswordResetEmailParams = {
  to: string;
  resetUrl: string;
};

type EmailVerificationEmailParams = {
  to: string;
  verifyUrl: string;
};

type TaskAutomationEmailParams = {
  to: string;
  trigger: "TASK_CREATED" | "TASK_COMPLETED";
  taskTitle: string;
  projectId: string;
  projectName: string;
  actorName: string;
  fallbackOrigin?: string;
};

function cleanEnvValue(name: string) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : undefined;
}

function getEmailProvider(): EmailProvider | "invalid" {
  return parseEmailProvider(cleanEnvValue("EMAIL_PROVIDER"));
}

function getAppBaseUrl(fallbackOrigin?: string) {
  const configuredUrl = cleanEnvValue("APP_BASE_URL") || fallbackOrigin || "http://localhost:3000";
  return configuredUrl.replace(/\/+$/, "");
}

async function sendEmail({
  to,
  content,
  successMessage,
  failureMessage,
  disabledMessage,
}: {
  to: string;
  content: EmailContent;
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

  try {
    const sent = await deliver(provider, { to, ...content });
    return sent
      ? { status: "sent", message: successMessage }
      : { status: "failed", message: failureMessage };
  } catch (error) {
    console.warn("Email request failed.", {
      provider,
      error: error instanceof Error ? error.message : "Unknown email error",
    });
    return { status: "failed", message: failureMessage };
  }
}

/** Sends through the configured provider. Returns false when it isn't set up or refuses the message. */
async function deliver(provider: Exclude<EmailProvider, "disabled">, email: OutgoingEmail) {
  if (provider === "smtp") {
    const settings = smtpSettings(process.env);
    if (!settings) return false;

    const { createTransport } = await import("nodemailer");
    const transport = createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: { user: settings.user, pass: settings.pass },
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    });
    await transport.sendMail({ from: smtpSender(settings), ...email });
    return true;
  }

  if (provider === "brevo") {
    const apiKey = cleanEnvValue("BREVO_API_KEY");
    const from = parseMailbox(cleanEnvValue("EMAIL_FROM"));
    if (!apiKey || !from) return false;

    const response = await fetch(BREVO_API_URL, {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(brevoPayload(from, email)),
    });
    if (!response.ok) console.warn("Email request failed.", { provider, status: response.status });
    return response.ok;
  }

  const apiKey = cleanEnvValue("RESEND_API_KEY");
  const from = cleanEnvValue("EMAIL_FROM");
  if (!apiKey || !from) return false;

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, ...email }),
  });
  if (!response.ok) console.warn("Email request failed.", { provider, status: response.status });
  return response.ok;
}

export async function sendProjectInvitationEmail({
  to,
  inviterName,
  inviterEmail,
  projectName,
  hasAccount,
  fallbackOrigin,
}: ProjectInvitationEmailParams): Promise<EmailDeliveryResult> {
  return sendEmail({
    to,
    content: projectInvitationEmail({ to, inviterName, inviterEmail, projectName, hasAccount, baseUrl: getAppBaseUrl(fallbackOrigin) }),
    successMessage: "Invitation created and email sent.",
    failureMessage: "Invitation created, but email could not be sent.",
    disabledMessage: "Invitation created. Email sending is not configured.",
  });
}

export async function sendPasswordResetEmail({ to, resetUrl }: PasswordResetEmailParams): Promise<EmailDeliveryResult> {
  return sendEmail({
    to,
    content: passwordResetEmail({ resetUrl }),
    successMessage: "If an account exists, a reset link was sent.",
    failureMessage: "If an account exists, a reset link was sent.",
    disabledMessage: "If an account exists, a reset link was sent.",
  });
}

/** "Confirm your email" with a link that proves the user owns the address (#130). */
export async function sendEmailVerificationEmail({ to, verifyUrl }: EmailVerificationEmailParams): Promise<EmailDeliveryResult> {
  return sendEmail({
    to,
    content: emailVerificationEmail({ verifyUrl }),
    successMessage: "Confirmation email sent.",
    failureMessage: "The confirmation email could not be sent. Try again in a few minutes.",
    disabledMessage: "Email sending is not configured.",
  });
}

/** A project automation's "email the owner" message (SMART-11). */
export async function sendTaskAutomationEmail({
  to,
  trigger,
  taskTitle,
  projectId,
  projectName,
  actorName,
  fallbackOrigin,
}: TaskAutomationEmailParams): Promise<EmailDeliveryResult> {
  return sendEmail({
    to,
    content: taskAutomationEmail({ trigger, taskTitle, projectId, projectName, actorName, baseUrl: getAppBaseUrl(fallbackOrigin) }),
    successMessage: "Automation email sent.",
    failureMessage: "Automation email could not be sent.",
    disabledMessage: "Email sending is not configured.",
  });
}
