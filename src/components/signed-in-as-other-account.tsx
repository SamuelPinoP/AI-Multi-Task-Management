import Link from "next/link";
import { uiButtonClass, uiCardClass, uiPrimaryButtonClass } from "@/components/ui";
import type { AuthUser } from "@/lib/auth";

/**
 * The log in and sign up pages show this instead of their form when someone is
 * signed in but the link was for another email address, such as a project
 * invitation opened on a computer signed in to a different account.
 */
export function SignedInAsOtherAccount({
  currentUser,
  email,
  switchHref,
  stayHref,
}: {
  currentUser: Pick<AuthUser, "email" | "isGuest">;
  /** The address the link was for. */
  email: string;
  /** Where logging out leads: the same page, signed out. */
  switchHref: string;
  stayHref: string;
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 items-center px-4 py-12">
      <section className={`${uiCardClass} w-full p-6`}>
        <h1 className="text-2xl font-semibold">Switch accounts?</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          This link is for <strong className="break-all text-zinc-950 dark:text-zinc-50">{email}</strong>, but you&apos;re signed in{" "}
          {currentUser.isGuest ? (
            "to a guest workspace"
          ) : (
            <>
              as <strong className="break-all text-zinc-950 dark:text-zinc-50">{currentUser.email}</strong>
            </>
          )}
          .
        </p>
        <form action="/api/auth/logout" method="post" className="mt-6">
          <input type="hidden" name="next" value={switchHref} />
          <button type="submit" className={`${uiPrimaryButtonClass} w-full justify-center`}>
            Log out and continue
          </button>
        </form>
        <Link href={stayHref} className={`${uiButtonClass} mt-3 w-full justify-center`}>
          Stay signed in
        </Link>
      </section>
    </main>
  );
}
