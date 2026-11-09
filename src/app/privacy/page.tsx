import type { Metadata } from "next";
import Link from "next/link";
import { ContactLink, LegalDocument, legalLinkClass, legalListClass, LegalSection } from "@/components/legal";
import { MINIMUM_AGE, TERMS_PATH } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy · AI Multi",
  description: "What AI Multi collects, why, who processes it, and the choices you have.",
};

/**
 * The Privacy Policy (#358), linked from the home page, the log in and sign up
 * pages, the Account page, and Google's sign-in screen (#356). Keep it true to
 * the code: update it, and LEGAL_LAST_UPDATED, whenever what the app collects
 * or who processes it changes.
 */
export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      intro={
        <>
          <p>
            AI Multi is a free app for notes, tasks, events, projects and team chat. Samuel Pino runs it as a personal,
            non-commercial project. This policy explains what AI Multi collects, why, who helps process it, and the choices
            you have. Questions are welcome at <ContactLink />.
          </p>
        </>
      }
    >
      <LegalSection id="summary" title="The short version">
        <ul className={legalListClass}>
          <li>AI Multi collects what it needs to work: your account details and what you create in it.</li>
          <li>It doesn&apos;t sell your data, show ads, or use analytics or advertising trackers.</li>
          <li>With Sign in with Google, it receives only your Google account&apos;s ID, name and email address.</li>
          <li>You can ask to see, export or delete your data at any time.</li>
          <li>AI Multi is for people {MINIMUM_AGE} and older.</li>
        </ul>
      </LegalSection>

      <LegalSection id="collect" title="What AI Multi collects">
        <p>
          <strong>Account details.</strong> Your name, username and email address, and your password, which is stored only
          as a salted scrypt hash that nobody can read back. AI Multi also records when you confirmed your email address.
        </p>
        <p>
          <strong>Sign in with Google.</strong> If you choose Continue with Google, Google shares your Google account&apos;s
          ID, your name and your email address, and whether Google has confirmed that address (the <code>openid</code>,{" "}
          <code>email</code> and <code>profile</code> scopes). AI Multi never receives your Google password and can&apos;t
          see your Gmail, Drive, contacts or anything else in your Google account. See{" "}
          <a href="#google" className={legalLinkClass}>
            Google user data
          </a>{" "}
          below.
        </p>
        <p>
          <strong>What you create.</strong> Notes, tasks, events, goals, projects, boards, tree pages, chat messages and
          comments, files you upload, and the email addresses of people you invite to a project.
        </p>
        <p>
          <strong>Signing in and preferences.</strong> A session cookie keeps you signed in; AI Multi stores only a SHA-256
          fingerprint of its secret. Other cookies and your browser&apos;s local storage remember your time zone, theme,
          accent color, text size, and how you left the sidebar, chats and calendar. All of these are needed for the app to
          work the way you set it up. There are no advertising or analytics cookies.
        </p>
        <p>
          <strong>Notifications.</strong> If you turn on browser notifications, AI Multi stores the push subscription your
          browser gives it. Your browser&apos;s push service (such as Google, Mozilla or Apple) uses it to deliver them.
        </p>
        <p>
          <strong>Security data.</strong> To limit sign-in attempts, sign-ups and emails, AI Multi counts requests by IP
          address and by account, keeping only SHA-256 fingerprints, never the addresses themselves. The hosting provider
          keeps short-lived request logs, which include IP addresses.
        </p>
      </LegalSection>

      <LegalSection id="use" title="How AI Multi uses it">
        <ul className={legalListClass}>
          <li>To run the app: sign you in, keep your work, and show it to you and to the people you share projects with.</li>
          <li>
            To send account emails: confirmation links, password resets, project invitations, and the reminders you set
            up. There are no marketing emails.
          </li>
          <li>To keep the app and its users safe: limits on attempts, abuse prevention, and confirming that email addresses are real.</li>
          <li>To recover from problems: a daily backup of the database.</li>
        </ul>
        <p>AI Multi doesn&apos;t sell or rent your data, use it for advertising, or use it to train AI models.</p>
      </LegalSection>

      <LegalSection id="google" title="Google user data">
        <p>
          When you use Sign in with Google, AI Multi uses your Google account&apos;s ID to recognize you on later sign-ins,
          your email address to create or find your AI Multi account (Google has confirmed it, so AI Multi treats it as
          confirmed), and your name as your display name. It stores these three and keeps no Google access tokens. It
          shares them with no one except the service providers below that run the app, and never uses them for advertising.
        </p>
        <p>
          AI Multi&apos;s use and transfer of information received from Google APIs adheres to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" className={legalLinkClass}>
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
      </LegalSection>

      <LegalSection id="sharing" title="Who can see your data">
        <ul className={legalListClass}>
          <li>
            <strong>People you work with.</strong> Members of a project you share see your name, email address and what you
            add to that project. People you invite get an email with your name and the project&apos;s name.
          </li>
          <li>
            <strong>Your calendar link.</strong> If you make a calendar subscription link, anyone with that link can see your
            events until you replace it.
          </li>
          <li>
            <strong>Service providers</strong> that process data for AI Multi, under their own privacy terms: Vercel hosts
            the app; Neon holds the database; Cloudflare R2 stores uploaded files and database backups; Google sends email
            (Gmail) and runs Sign in with Google; GitHub supplies public repository details when a project links a
            repository (AI Multi sends it only the repository&apos;s name); and your browser&apos;s push service delivers
            the notifications you turned on.
          </li>
          <li>
            <strong>When the law requires it</strong>, or to protect people from harm.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="retention" title="How long data is kept">
        <ul className={legalListClass}>
          <li>Your account and what you create: until you delete them or ask for your account to be deleted.</li>
          <li>Items you delete wait in Trash until you empty it or delete them for good.</li>
          <li>Guest workspaces: deleted 30 days after their last use.</li>
          <li>Sign-in sessions: they end 30 days after their last use, and a year after signing in at the latest.</li>
          <li>Email confirmation links: 24 hours. Password reset links: 1 hour.</li>
          <li>Notifications in the app: 90 days.</li>
          <li>Database backups: the 30 most recent daily backups, so deleted data leaves the backups within 30 days.</li>
        </ul>
      </LegalSection>

      <LegalSection id="choices" title="Your choices and rights">
        <p>
          You can change your username on the Account page and delete what you create. To get a copy of your data, correct
          your details, or delete your account and everything in it, email <ContactLink /> from the address on your account.
          You&apos;ll get an answer within 30 days. Depending on where you live, you may have more rights, such as objecting
          to how your data is used or complaining to your data protection authority.
        </p>
      </LegalSection>

      <LegalSection id="security" title="Security">
        <p>
          Connections use HTTPS. Passwords are hashed with scrypt, and the secrets in sessions and emailed links are stored
          only as fingerprints. Uploaded files are stored privately and served only to people with access to them, and every
          request is checked against your role in the project. No system is perfectly secure, so please use a strong
          password you don&apos;t use anywhere else.
        </p>
      </LegalSection>

      <LegalSection id="age" title="Age">
        <p>
          AI Multi is for people {MINIMUM_AGE} and older, partly because the AI assistant it plans to add uses a service
          that may not be offered to anyone younger. AI Multi doesn&apos;t knowingly collect data from anyone under{" "}
          {MINIMUM_AGE}. If you believe someone under {MINIMUM_AGE} has an account, email <ContactLink /> and it will be
          deleted.
        </p>
      </LegalSection>

      <LegalSection id="ai" title="The AI assistant (coming later)">
        <p>
          An AI assistant powered by Google&apos;s Gemini API is planned. Before it launches, this policy will explain what
          it sends to Google and how Google may use it, and the app will tell you before you first use it.
        </p>
      </LegalSection>

      <LegalSection id="location" title="Where data is processed">
        <p>AI Multi and its providers may process data in the United States and in other countries where they operate.</p>
      </LegalSection>

      <LegalSection id="changes" title="Changes to this policy">
        <p>
          When this policy changes, the date at the top changes too. For significant changes, you&apos;ll be told in the app
          or by email before they take effect. Using AI Multi is also subject to the{" "}
          <Link href={TERMS_PATH} className={legalLinkClass}>
            Terms of Service
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <p>
          Samuel Pino, <ContactLink />.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
