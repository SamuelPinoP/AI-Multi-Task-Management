// Live check for email deliverability (#232).
//
// Sends sample emails through the app's own email code to an address you
// choose. Use an address from https://www.mail-tester.com to get a spam score
// out of 10, or your own inbox to see whether they land in Inbox or Junk.
//
// Reads .env (or the file named by DOTENV_CONFIG_PATH) for EMAIL_PROVIDER and
// its settings, so set those like production's to test what users get. The
// links point at production, like real emails. Prints only the result of each
// send, never settings. Each email counts toward the provider's daily limit
// (about 500 for Gmail).
//
//   npm run email:test -- <address> [verification|reset|invitation|automation|all]
//
// The default is "verification", the first email a new user gets; mail-tester
// scores one email per address.
import "dotenv/config";
import {
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
  sendProjectInvitationEmail,
  sendTaskAutomationEmail,
  type EmailDeliveryResult,
} from "../src/lib/email";

const PRODUCTION_URL = "https://ai-multi-task-management-vercel.vercel.app";
const SAMPLE_TOKEN = "sample-token-from-npm-run-email-test";

const [to, kind = "verification"] = process.argv.slice(2);
const senders: Record<string, (to: string) => Promise<EmailDeliveryResult>> = {
  verification: (to) => sendEmailVerificationEmail({ to, verifyUrl: `${PRODUCTION_URL}/verify-email?token=${SAMPLE_TOKEN}` }),
  reset: (to) => sendPasswordResetEmail({ to, resetUrl: `${PRODUCTION_URL}/reset-password?token=${SAMPLE_TOKEN}` }),
  invitation: (to) =>
    sendProjectInvitationEmail({ to, inviterName: "Dana Lee", inviterEmail: "dana@example.com", projectName: "Capstone", hasAccount: false }),
  automation: (to) =>
    sendTaskAutomationEmail({ to, trigger: "TASK_COMPLETED", taskTitle: "Draft the slides", projectId: "sample", projectName: "Capstone", actorName: "Dana Lee" }),
};

async function main() {
  if (!to || !/^[^\s@]+@[^\s@]+$/.test(to) || (kind !== "all" && !senders[kind])) {
    console.error("Usage: npm run email:test -- <address> [verification|reset|invitation|automation|all]");
    process.exit(2);
  }

  // Links in the emails use APP_BASE_URL; point them at production, as in real emails.
  process.env.APP_BASE_URL = PRODUCTION_URL;

  let failures = 0;
  for (const name of kind === "all" ? Object.keys(senders) : [kind]) {
    const result = await senders[name](to);
    console.log(`${result.status.toUpperCase()} ${name}: ${result.message}`);
    if (result.status !== "sent") failures += 1;
  }
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
