// Email provider settings, kept free of server-only imports so they can be
// unit tested. src/lib/email.ts does the sending.

export const EMAIL_PROVIDERS = ["disabled", "resend", "smtp", "brevo"] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

type Env = Record<string, string | undefined>;

export function parseEmailProvider(value: string | undefined): EmailProvider | "invalid" {
  const provider = value?.trim().toLowerCase();
  if (!provider) return "disabled";
  return (EMAIL_PROVIDERS as readonly string[]).includes(provider) ? (provider as EmailProvider) : "invalid";
}

export type Mailbox = { name?: string; email: string };

/** Reads `Name <address>` or a bare address. Returns null for anything else. */
export function parseMailbox(value: string | undefined): Mailbox | null {
  const trimmed = value?.trim() ?? "";
  const named = /^(.*?)\s*<([^<>\s@]+@[^<>\s@]+)>$/.exec(trimmed);
  if (named) {
    const name = named[1].trim().replace(/^"(.*)"$/, "$1").trim();
    return name ? { name, email: named[2] } : { email: named[2] };
  }
  return /^[^<>\s@]+@[^<>\s@]+$/.test(trimmed) ? { email: trimmed } : null;
}

export type SmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
};

/**
 * SMTP settings, defaulting to Gmail (smtp.gmail.com, port 465 with TLS).
 * Returns null when the login is missing or the port is invalid.
 */
export function smtpSettings(env: Env): SmtpSettings | null {
  const host = env.SMTP_HOST?.trim() || "smtp.gmail.com";
  const port = Number(env.SMTP_PORT?.trim() || "465");
  const user = env.SMTP_USER?.trim();
  // Google shows app passwords in groups of four; the spaces aren't part of it.
  const pass = host === "smtp.gmail.com" ? env.SMTP_PASS?.replace(/\s+/g, "") : env.SMTP_PASS;

  if (!user || !pass) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port, secure: port === 465, user, pass };
}

export type OutgoingEmail = { to: string; subject: string; text: string; html: string };

/** Request body for Brevo's transactional email API. */
export function brevoPayload(from: Mailbox, email: OutgoingEmail) {
  return {
    sender: from.name ? { name: from.name, email: from.email } : { email: from.email },
    to: [{ email: email.to }],
    subject: email.subject,
    textContent: email.text,
    htmlContent: email.html,
  };
}
