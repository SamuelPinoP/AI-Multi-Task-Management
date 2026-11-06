import type { Metadata } from "next";
import Link from "next/link";
import { ContactLink, LegalDocument, legalLinkClass, legalListClass, LegalSection } from "@/components/legal";
import { MINIMUM_AGE, PRIVACY_PATH } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service · AI Multi",
  description: "The rules for using AI Multi, a free app for notes, tasks, events, projects and team chat.",
};

/**
 * The Terms of Service (#358), linked from the home page, the log in and sign
 * up pages, the Account page, and Google's sign-in screen (#356). Update
 * LEGAL_LAST_UPDATED with every change.
 */
export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of Service"
      intro={
        <p>
          These terms are an agreement between you and Samuel Pino, who runs AI Multi, a free app for notes, tasks, events,
          projects and team chat. By creating an account or using AI Multi, you agree to them and to the{" "}
          <Link href={PRIVACY_PATH} className={legalLinkClass}>
            Privacy Policy
          </Link>
          . If you don&apos;t agree, please don&apos;t use AI Multi.
        </p>
      }
    >
      <LegalSection id="eligibility" title="Who can use AI Multi">
        <p>
          You must be at least {MINIMUM_AGE} years old. You need an email address you can open, which you confirm before your
          first login, or a Google account to sign in with. Each account is for one person.
        </p>
      </LegalSection>

      <LegalSection id="account" title="Your account">
        <p>
          Keep your password private, and email <ContactLink /> if you think someone else has used your account. You&apos;re
          responsible for what happens in your account. You can stop using AI Multi at any time and ask for your account to
          be deleted.
        </p>
      </LegalSection>

      <LegalSection id="content" title="Your content">
        <p>
          What you create in AI Multi stays yours. You allow AI Multi to store, copy, process and display it only as needed
          to run the app for you and for the people you share it with: for example, to show a project&apos;s tasks to its
          members, or to keep backups. You confirm you have the right to upload what you share, and you&apos;re responsible
          for it.
        </p>
      </LegalSection>

      <LegalSection id="acceptable-use" title="Acceptable use">
        <p>Don&apos;t use AI Multi to:</p>
        <ul className={legalListClass}>
          <li>break the law or infringe anyone&apos;s rights;</li>
          <li>upload malware, or content that harasses, threatens or exploits other people;</li>
          <li>send spam, including invitations to people who didn&apos;t ask for them;</li>
          <li>get into accounts or data that aren&apos;t yours, probe or break the app&apos;s security, or get around its limits;</li>
          <li>overload the app, or copy its content with automated tools;</li>
          <li>pretend to be someone else.</li>
        </ul>
        <p>Content or accounts that break these rules may be removed or suspended.</p>
      </LegalSection>

      <LegalSection id="sharing" title="Projects and sharing">
        <p>
          A project&apos;s owner decides who can see and edit it. What you add to a shared project can be seen by its
          members, and stays in the project if you leave it.
        </p>
      </LegalSection>

      <LegalSection id="free-service" title="A free service">
        <p>
          AI Multi is free and runs on free hosting plans. It may change, slow down, pause or stop, and features may be added
          or removed. Before AI Multi shuts down for good, you&apos;ll be told in time to ask for a copy of your data. Keep
          your own copies of anything important.
        </p>
      </LegalSection>

      <LegalSection id="ai" title="AI features">
        <p>
          AI features, when they&apos;re available, can give wrong or incomplete answers. Check them before you rely on them,
          and don&apos;t share sensitive information with them.
        </p>
      </LegalSection>

      <LegalSection id="third-parties" title="Other companies' services">
        <p>
          Sign in with Google, linked GitHub repositories and browser notifications are provided by other companies, under
          their own terms.
        </p>
      </LegalSection>

      <LegalSection id="ending" title="Ending your account">
        <p>
          You can stop at any time and ask for your account to be deleted. An account that breaks these terms, or puts other
          people or the app at risk, may be suspended or closed, with the reason given when possible.
        </p>
      </LegalSection>

      <LegalSection id="disclaimer" title="No warranty">
        <p>
          AI Multi is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind, as far as
          the law allows. There&apos;s no promise that it will always be available, free of errors, or that data will never
          be lost.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="Limitation of liability">
        <p>
          As far as the law allows, AI Multi and Samuel Pino aren&apos;t liable for indirect, incidental, special or
          consequential damages, or for lost data, profits or revenue. Total liability for any claim about AI Multi is
          limited to the greater of what you paid for it in the 12 months before the claim (nothing, since it&apos;s free)
          and 50 US dollars. Some places don&apos;t allow these limits, so they may not apply to you.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="Changes to these terms">
        <p>
          These terms may change. For significant changes, you&apos;ll be told in the app or by email before they take
          effect. Using AI Multi after that means you accept the new terms.
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
