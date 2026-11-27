# Conventions

How the code does things, and the traps that cost time. Read what your change touches. Times in the database are in [database.md](database.md#times-in-the-database).

## In the code

- **Event times** are wall-clock values stored as UTC (9:00 AM is `09:00Z`), in `src/lib/event-time.ts`. Repeats are in `src/lib/recurrence.ts` and `src/lib/event-occurrences.ts`. Skipped days are `Event.skippedDates`: any new query that selects event fields for repeats must include it. **Task due dates** are dates without a time (`src/lib/task-date-buckets.ts`).
- **Time zones:** the server's "today" comes from the browser's zone in the `tz` cookie (`getUserNow()`, `getUserTimeZone()` in `src/lib/user-time-server.ts`). Client components format with `formatInstant()` and `dayKeyInZone()` (`src/lib/user-time.ts`) and get the zone from `src/components/user-time-zone.tsx`. Never use `toLocaleString(undefined, …)` or a bare `new Date()` for "today" in a client component: hydration fails (React #418) outside UTC.
- **Writes** to tasks, projects and events go through `src/lib/task-writes.ts`, `project-writes.ts`, `event-writes.ts` and `writes.ts`, shared by the API routes and the AI. A new API route that writes events, tasks, projects or members also calls `refreshCalendarFeeds` (a unit test checks every route).
- **Auth** (`src/lib/auth.ts`): the app's own sessions (`Session`, tokens stored as SHA-256) and scrypt passwords. Redirects are checked in `src/lib/safe-redirect.ts`; `src/proxy.ts` sends signed-out visitors to the login page; rate limits are in `src/lib/rate-limit-core.ts` (per-IP limits skip local requests). Unconfirmed accounts count as signed out. Usernames are in `src/lib/username.ts`. Google sign-in is an OIDC code flow with `OAuthAccount`.
  - A session ends 30 days after its last use and a year after login (`src/lib/session-lifetime.ts`); `getCurrentUser()` renews it at most daily, inside the request. Never add a timer or request just to keep sessions alive: Neon bills awake time.
  - Keep the login a plain form post that answers with a redirect, with `autocomplete="username"` and `current-password`, so password managers save it. Sign-up saves the email as the login.
- **Guests:** limits and the sign-up pop-up's words are in `src/lib/guest-limits-core.ts`, counted in `src/lib/guest-limits.ts` (rows marked `isStarter` don't count). Refused calls answer 403 with `code: "GUEST_LIMIT"` or `"ACCOUNT_REQUIRED"`, which pages turn into the pop-up with `openGuestSignupFor()` (`src/lib/workspace-events.ts`). `/` starts a guest (`POST /api/auth/guest/start`, which refuses other sites and bots). Signing up turns the guest into the account (`src/lib/guest-upgrade.ts`).
- **Project access:** `src/lib/project-access.ts` and `src/lib/project-roles.ts`: Owner, Admin (also manages people; only the owner dismisses an admin) and Editor. Invitations are in `src/lib/project-invitations.ts`; nobody is a member before accepting.
- **Chat:** storage is in `src/lib/project-chat-storage.ts`. The S3 client keeps `requestChecksumCalculation` and `responseChecksumValidation` at `WHEN_REQUIRED`, or R2 rejects uploads. An open chat refreshes every 7 seconds while visible and stops after 10 idle minutes; unread counts use `ProjectChatRead`. `/chats` also holds direct messages (`DirectChat`, `DirectMessage`, `DirectChatRead`) and project photos (`ProjectPhoto`).
- **App shell:** `src/components/app-shell.tsx`, with matching and titles in `src/lib/app-nav.ts`. Sidebar counts come from `src/lib/workspace-nav.ts`, refetched on navigation and `notifyWorkspaceChanged()`. On phones the profile is in the top bar.
- **Tree view:** every move (drag, "Move to…", undo) goes through `moveNode` in `src/components/tree/tree-board.tsx`.
- **Design tokens:** colors, elevation and type are in `globals.css`. `src/lib/design-tokens.test.ts` checks every text color on every surface, theme and accent palette; `scripts/generate-accent-palettes.mjs` writes the five palettes (rerun it after changing a teal token). Sizes are in rem, never px, so the Text size setting scales them.
- **UI pieces:** `toast` from `@/components/ui/toaster`; dialogs in `src/components/ui/dialog.tsx` and `src/components/confirm-dialog.tsx`; `DeleteButton` in `src/components/ui/delete-button.tsx`; message boxes that grow with their text in `src/components/ui/growing-textarea.tsx`; class names joined with `cn()` (`src/lib/cn.ts`).
- **Accessibility:** a control's visible text must be part of its accessible name (axe's `label-content-name-mismatch`), even text marked `aria-hidden`.
- **Legal pages:** change `LEGAL_LAST_UPDATED` in `src/lib/legal.ts` with every edit to the Privacy Policy or Terms.
- **Owner-only pages:** `/usage` shows only to `ADMIN_EMAILS` (`src/lib/app-admin-core.ts`); everyone else gets the normal 404. Feedback goes to the same addresses.
- **AI apps (MCP):** `MCP_ENABLED` turns on `/api/mcp`, sign-in for apps and the Integrations page together. The switch and the address live in `src/lib/mcp/connect.ts`, which loads no MCP SDK, so the app shell can read it; while it's off, the endpoints answer 404, the pages show the not-found page, and nothing links to them.
  - Sign-in (OAuth 2.1, #477): the rules are plain functions in `src/lib/mcp/oauth.ts`, the endpoints are `(Request) => Response` functions in `oauth-server.ts` with the tables (`oauth-store.ts`), the metadata fetcher and the clock passed in, and the routes only wire them up (`oauth-routes.ts`). Fetching an app's metadata document goes through `client-metadata.ts`, which reaches public https addresses only: never fetch an address a visitor gave any other way.
- **Env vars:** every new one goes in `.env.example` and `scripts/validate-deployment-env.mjs`.
- `next dev` keeps a Next.js block in `AGENTS.md` current; if an upgrade changes it, commit the new version.

## Code traps

- `notFound()` in a page sends the not-found page with a 200, not a 404: `src/app/loading.tsx` makes every page stream, so the status goes first. Tests check for "This page could not be found." instead. `redirect()` in a page likewise happens in the browser, so an answer that must be a real 303, such as Allow on the consent page, comes from a route handler.
- Join Tailwind classes with `cn()`: a template string such as `` `${uiPrimaryButtonClass} px-3 py-1.5` `` keeps the base `py-2`, and the button grows.
- A `grid` whose rows truncate text needs `grid-cols-1` (`minmax(0, 1fr)`), or an auto column grows to the longest row.
- Text that can hold a long link or word (messages, answers) needs `wrap-anywhere`: `whitespace-pre-wrap` breaks only at spaces, and `break-words` doesn't stop a grid column or flex item from first growing to the word's width.
- Hidden text (`sr-only`) is absolutely positioned, so it belongs to the nearest positioned ancestor, not to the scroller it sits in. A scroller that holds some needs `relative`, or the text far down its content stretches the box around it: a second scrollbar (#244, the window; #566, the AI chat and the Chats list).
- An invisible copy of a textarea's text doesn't wrap exactly like the textarea: typing, the textarea wraps a keystroke or two earlier, and on Windows the scrollbar that appears takes 15 px, so a box sized by the copy stays a line short with its first line hidden (#569). Size a textarea by its own text (`field-sizing: content`, as `GrowingTextarea` does).
- React bubbles events from portals to the surrounding form: a picker's button inside a form submitted it.
- Memoize context values: a new object on every render forces React to client-render pages still hydrating.
- A window key listener whose effect depends on refreshed data re-registers on every refresh and drops half-typed shortcuts ("g then a letter"): read the data through a ref.
- A `String.replace` replacement containing `` $` `` inserts the text before the match: pass a function.
- Escaping by hand fails CodeQL unless `\` is escaped first; better, don't build a RegExp from data.
- Next.js links a file-based `app/icon.svg` only without `metadata.icons`, and `/icon.svg` falls under the sign-in redirect in `src/proxy.ts`: hence `/icons/icon.svg`.
- Android draws a notification `badge` from its alpha channel: use a white mark on transparent.
- dnd-kit's auto-scroll starts in the outer fifth of the view; the tree uses 10%. The React Compiler lint (`react-hooks/refs`) flags `drag.listeners`: destructure the hook's result.
