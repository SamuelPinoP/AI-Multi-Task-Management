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
          <li>It doesn&apos;t sell your data, show ads, or use advertising trackers.</li>
          <li>It counts visits anonymously, with no cookies and no IP addresses.</li>
          <li>It records when and how you sign in, and when you last used it, but never your IP address.</li>
          <li>With Sign in with Google, it receives only your Google account&apos;s ID, name and email address.</li>
          <li>
            If you ask the AI assistant something, your question and what it looks up to answer go to Google&apos;s Gemini
            API, only after you agree to that. So does a task you ask it to estimate; once a task has an estimate, its
            subtasks get one automatically. AI Multi keeps your last 20 chats with it until you delete them.
          </li>
          <li>
            If you connect an AI app such as Claude or ChatGPT, it can read your work when you ask it to, and change it if
            you allow that, and the company that runs it processes what it reads. You can disconnect it at any time.
          </li>
          <li>You can ask to see, export or delete your data at any time.</li>
          <li>AI Multi is for people {MINIMUM_AGE} and older.</li>
        </ul>
      </LegalSection>

      <LegalSection id="collect" title="What AI Multi collects">
        <p>
          <strong>Account details.</strong> Your name, username and email address, and your password, which is stored only
          as a salted scrypt hash that nobody can read back. AI Multi also records when you confirmed your email address.
          Someone who types your exact username can invite you to a project; they see your name, never your email, and
          nobody can browse or search everyone in AI Multi.
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
          <strong>What you create.</strong> Notes, tasks, events, goals, projects, boards, tree pages, project chat messages
          and comments, direct messages to people you share a project with (only the two of you see them), files you
          upload, and the email addresses of people you invite to a project.
        </p>
        <p>
          <strong>Signing in and preferences.</strong> A session cookie keeps you signed in; AI Multi stores only a SHA-256
          fingerprint of its secret. Other cookies and your browser&apos;s local storage remember your time zone, theme,
          accent color, text size, how you left the sidebar, chats and calendar, and whether this browser has signed in to
          an account before, so it opens the log-in page instead of a guest workspace. All of these are needed for the app
          to work the way you set it up. There are no advertising or analytics cookies. AI Multi also saves your time zone
          (such as &quot;Europe/Madrid&quot;) with your account, so AI apps you connect know which day it is for you.
        </p>
        <p>
          <strong>Trying it without an account.</strong> If you open AI Multi without an account, it makes a guest
          workspace with a few sample items. What you add stays in it, reachable only from this browser, until 30 days
          after your last visit. If you sign up from it, the guest workspace becomes your account.
        </p>
        <p>
          <strong>Sign-in history.</strong> Each time you sign in, AI Multi records when, how (with a password or Google, or
          by signing up), the kind of browser and device (such as &quot;Chrome on Windows&quot;), and the country your
          connection comes from, as the hosting provider reports it. It keeps neither your IP address nor the rest of what
          your browser sends. It also records when you last used the app, to the nearest hour.
        </p>
        <p>
          <strong>Visits.</strong> AI Multi counts page views with Vercel Web Analytics, which sets no cookies and keeps no
          IP addresses. Each view records the page&apos;s address (without anything after a &quot;?&quot; or &quot;#&quot;,
          and with ids replaced), the site you came from, your approximate location (country, region and city), and your
          browser, system and kind of device. Vercel tells visits apart by a fingerprint of the request that it discards
          after 24 hours, and AI Multi sees only totals, never who visited.
        </p>
        <p>
          <strong>The AI assistant.</strong> When you agree to its notice, AI Multi records when. It keeps your chats with
          the assistant, so you can come back to them: your questions, its answers, the links they showed to your items,
          and the changes it proposed, with which ones you applied. For each message you send it, and each estimate it makes, AI Multi also keeps a usage record: when, which model answered, how it
          went, how many requests and tokens it took, and the names of the lookups it made (such as &quot;open
          tasks&quot;), never what you asked or what it answered. See{" "}
          <a href="#ai" className={legalLinkClass}>
            The AI assistant
          </a>{" "}
          below.
        </p>
        <p>
          <strong>Connected AI apps.</strong> If you connect an AI app to your account, AI Multi keeps the connection and a
          record of each lookup the app makes, never what it asked or what it got. See{" "}
          <a href="#ai-apps" className={legalLinkClass}>
            Connected AI apps
          </a>{" "}
          below.
        </p>
        <p>
          <strong>Feedback.</strong> If you use Send feedback, your message is emailed to Samuel with your name, username
          and email address, and whether he may email you about it. AI Multi doesn&apos;t store it; it stays in his email.
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
          <li>
            To understand how AI Multi is used, so it can get better: how many people visit (as anonymous totals), sign up,
            sign in and come back, and how many notes, tasks, events, projects and messages each account has, never what
            they say.
          </li>
          <li>
            To hear what you think: Samuel reads what you send with Send feedback, and may email you now and then,
            personally, to ask for your opinion of AI Multi. Answering is up to you, and if you&apos;d rather not be asked,
            say so and he won&apos;t ask again.
          </li>
          <li>To answer what you ask the AI assistant, and to estimate how long tasks will take, with Google&apos;s Gemini API.</li>
          <li>To let the AI apps you connect look up your work when you ask them to.</li>
          <li>To recover from problems: a daily backup of the database.</li>
        </ul>
        <p>
          AI Multi doesn&apos;t sell or rent your data, use it for advertising, or use it to train AI models. During the
          free beta, Google may use what the AI assistant sends it, as{" "}
          <a href="#ai" className={legalLinkClass}>
            The AI assistant
          </a>{" "}
          explains.
        </p>
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
            events and due tasks until you replace it or turn it off. A copy of that calendar is kept in storage for calendar
            apps to fetch, and is deleted when you replace the link or turn it off.
          </li>
          <li>
            <strong>Samuel, who runs AI Multi.</strong> He gets an email with your name, username and email address when you
            create an account. On a page only he can open, he sees each account&apos;s name, username and email address, its
            sign-in history, when it was last active, and how many items it has, never their content. He looks at anything
            else only to help you, to fix a problem, or when the law requires it.
          </li>
          <li>
            <strong>Service providers</strong> that process data for AI Multi, under their own privacy terms: Vercel hosts
            the app and counts visits (Web Analytics); Neon holds the database; Cloudflare R2 stores uploaded files, the calendar copies behind calendar links, and database backups; Google sends email
            (Gmail), runs Sign in with Google, and answers the AI assistant&apos;s questions and makes its estimates (the Gemini API); GitHub supplies public repository details when a project links a
            repository (AI Multi sends it only the repository&apos;s name); and your browser&apos;s push service delivers
            the notifications you turned on.
          </li>
          <li>
            <strong>AI apps you connect</strong>, and the companies that run them, get what those apps look up, as{" "}
            <a href="#ai-apps" className={legalLinkClass}>
              Connected AI apps
            </a>{" "}
            explains.
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
          <li>Sign-in history: a year.</li>
          <li>Feedback you send: in Samuel&apos;s email until he deletes it.</li>
          <li>Visit counts: anonymous totals that Vercel keeps under its own terms; the fingerprint that tells visits apart, 24 hours.</li>
          <li>Email confirmation links: 24 hours. Password reset links: 1 hour.</li>
          <li>Notifications in the app: 90 days.</li>
          <li>
            Chats with the AI assistant: your last 20, until you delete them. Starting a 21st deletes the oldest, and a chat
            you haven&apos;t opened for 90 days is deleted.
          </li>
          <li>AI assistant usage records: 90 days.</li>
          <li>Connected AI apps: until you disconnect them. The record of their lookups: 30 days.</li>
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
          AI Multi is for people {MINIMUM_AGE} and older, partly because its AI assistant uses a service that may not be
          offered to anyone younger. AI Multi doesn&apos;t knowingly collect data from anyone under{" "}
          {MINIMUM_AGE}. If you believe someone under {MINIMUM_AGE} has an account, email <ContactLink /> and it will be
          deleted.
        </p>
      </LegalSection>

      <LegalSection id="ai" title="The AI assistant">
        <p>
          The AI assistant answers questions about your work and estimates how long tasks will take. It runs on
          Google&apos;s Gemini API. Before your first question, the app tells you what it sends and asks you to agree;
          until you do, nothing is sent. After that, something is sent only when you ask something, when you click
          Estimate on a task, or when a task with an estimate has subtasks to estimate (see Estimates below).
        </p>
        <ul className={legalListClass}>
          <li>
            <strong>What is sent to Google:</strong> your question with the messages before it in that chat (up to 12 in
            all), and what the assistant looks up in your workspace to answer it. That can be task titles, numbers (such as
            AM-142), statuses, priorities and due dates; event titles, dates and times; the names of the projects these
            belong to and how far along each project is; note titles with a short excerpt; and your weekly goals. It sends
            only what the question needs, never your whole workspace, and never your email address or password. For an
            estimate, it sends only the task&apos;s title and description and the titles of its subtasks.
          </li>
          <li>
            <strong>Estimates:</strong> on a task without an estimate, Estimate asks how long it will take and adds the
            answer as the task&apos;s Estimate section, marked AI estimate, which you can edit or remove like any section.
            Its subtasks without an estimate get one in the same request. After that, its subtasks follow it: a subtask
            added later gets its own estimate automatically, and when a task gets an estimate after its subtasks exist,
            those without one get theirs. Each request is made for the person who added the subtask or the estimate, and
            only if they have agreed to the assistant&apos;s notice.
          </li>
          <li>
            <strong>How Google may use it:</strong> during the free beta, AI Multi uses the Gemini API&apos;s free tier.
            Under the{" "}
            <a href="https://ai.google.dev/gemini-api/terms" className={legalLinkClass}>
              Gemini API Additional Terms of Service
            </a>
            , Google may use what is sent to improve its products, and people at Google may read it. So don&apos;t include
            passwords, health or money details, or anything confidential, in your questions or in what you ask about.
          </li>
          <li>
            <strong>In the European Economic Area, Switzerland and the United Kingdom,</strong> Google&apos;s free tier may
            not be used, so nothing is sent to Google: your planner answers instead, and tasks get no AI estimates.
          </li>
          <li>
            <strong>What AI Multi keeps:</strong> when you agreed to the notice; your last 20 chats, each with your
            questions, the answers, the links they showed, and the changes the assistant proposed, with which ones you
            applied; and a usage record of each message and estimate for 90 days, without its
            content. Starting a 21st chat deletes the oldest, and a chat you haven&apos;t opened for 90 days is deleted.
          </li>
          <li>
            <strong>Deleting your chats:</strong> delete a chat from its ⋯ menu, or every chat with Delete all chats under
            the list on the AI page. They&apos;re deleted for good, and leave the backups within 30 days.
          </li>
          <li>
            <strong>Limits:</strong> each account may send a set number of requests a day, and each estimate is one; after
            that, your planner answers and no estimates are made until the next day.
          </li>
        </ul>
        <p>
          Answers can be wrong; check them before you rely on them. The assistant can propose changes to your tasks,
          projects and calendar, such as a new task, a new date, or moving a task to the Trash, but it can&apos;t make them.
          Nothing changes until you tick the ones you want and apply them yourself, as you; you can cancel instead, and
          what you leave expires after an hour. Changes you apply show in Activity as made via AI Multi. Estimates are the
          exception: they go straight into the task&apos;s Estimate section, as you, and show in its Activity the same way.
        </p>
      </LegalSection>

      <LegalSection id="ai-apps" title="Connected AI apps">
        <p>
          You can connect an AI app that supports MCP, such as Claude, ChatGPT or Cursor, to your AI Multi account, so it
          can look up your work, and change it if you allow that, when you ask it to. An app connects only after you approve
          it on an AI Multi page that names it. Guest workspaces and accounts whose email address isn&apos;t confirmed can&apos;t connect one.
        </p>
        <ul className={legalListClass}>
          <li>
            <strong>What a connected app can see:</strong> what it looks up to answer you, from the tasks, events, projects,
            notes and weekly goals you can see in AI Multi, including those in projects you share with other people. That
            can be task titles, numbers (such as AM-142), descriptions, statuses, priorities, due dates and labels, and the
            tasks, notes and goals they&apos;re linked to; event titles, dates and times; project names and how far along
            each project is; note titles with a short excerpt; your weekly goals; and counts of your tasks. When it
            changes something, it also gets back what changed, and the names of a shared project&apos;s members or labels it
            asked for. It never sees your password or anyone&apos;s email address.
          </li>
          <li>
            <strong>Who processes it:</strong> what an app reads goes to the company that runs it, such as Anthropic, OpenAI
            or Google, and from then on that company&apos;s terms and privacy policy apply, not this one. Connect only apps
            you trust, and check their terms before you do.
          </li>
          <li>
            <strong>What it can do:</strong> what you allow on that page: see your work, and, if you leave the box ticked,
            create and change tasks, events, notes and projects, comment on tasks, and move tasks, events and notes to the
            Trash, where you can restore them. It can&apos;t delete anything for good, and it can only change what you could
            change yourself. Its changes are made as you, and Activity and a task&apos;s history name the app, such as
            &quot;via Claude&quot;.
          </li>
          <li>
            <strong>What AI Multi keeps:</strong> each connection, with the app&apos;s name, the address the page showed,
            what you allowed it, when you connected it and when it was last used, to the nearest hour; a sign-in for each
            device the app is connected on, stored only as a hash, which ends after 30 days without use and a year after
            connecting at the latest; for 30 days, a record of each lookup or change: which app, which tool (such as
            &quot;open tasks&quot; or &quot;create tasks&quot;), whether it worked, how long it took and when, never what the
            app asked or what it got; and, with a task an app made from a web page such as a pull request, that page&apos;s
            address, so the same page doesn&apos;t get a second task. A connection is deleted 30 days after you disconnect
            it; the changes an app made stay, like your own.
          </li>
          <li>
            <strong>Disconnecting:</strong> on the Integrations page, under Connected apps, click Disconnect next to the
            app. It loses access at once. Deleting your account disconnects every app.
          </li>
        </ul>
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
