// Kept free of server-only imports so it can be unit tested with plain Node, and shared with the browser.

/**
 * What a guest workspace may hold (#458): enough to try AI Multi, small enough to cost nothing. Only
 * what the guest made counts; items the app added (a template's, the sample workspace's) don't.
 */
export const GUEST_LIMITS = { tasks: 5, events: 2, notes: 3, projects: 1 } as const;

export type GuestLimitKind = keyof typeof GUEST_LIMITS;

/** How many of each the guest has made, trashed ones included. */
export type GuestUsage = Record<GuestLimitKind, number>;

/** Why the sign-up pop-up opened: a limit, something only accounts can do, or the guest's own choice. */
export type GuestSignupReason = GuestLimitKind | "ai" | "ai-apps" | "people" | "messages" | "calendar-feed" | "notifications" | "signup";

/** The API's answer, with status 403, when a guest asks for more than their workspace holds. */
export const GUEST_LIMIT_CODE = "GUEST_LIMIT";
/** The API's answer, with status 403, when a guest asks for something only accounts can do. */
export const ACCOUNT_REQUIRED_CODE = "ACCOUNT_REQUIRED";

export type GuestRefusal = { error: string; code: typeof GUEST_LIMIT_CODE | typeof ACCOUNT_REQUIRED_CODE; reason: GuestSignupReason };

const NOUNS: Record<GuestLimitKind, [one: string, many: string]> = {
  tasks: ["task", "tasks"],
  events: ["event", "events"],
  notes: ["note", "notes"],
  projects: ["project", "projects"],
};

function counted(kind: GuestLimitKind, count: number) {
  const [one, many] = NOUNS[kind];
  return `${count} ${count === 1 ? one : many}`;
}

/** How many more the guest may make, never below zero. */
export function guestLeft(usage: GuestUsage, kind: GuestLimitKind) {
  return Math.max(0, GUEST_LIMITS[kind] - usage[kind]);
}

/** Whether `adding` more fit in the guest workspace. */
export function guestHasRoom(usage: GuestUsage, kind: GuestLimitKind, adding = 1) {
  return usage[kind] + adding <= GUEST_LIMITS[kind];
}

const ACCOUNT_ONLY: Record<Exclude<GuestSignupReason, GuestLimitKind | "signup">, { title: string; error: string }> = {
  ai: { title: "The AI needs a free account", error: "Create an account to use the AI assistant." },
  // Apps sign in to an account over OAuth (#477), and guests can't grant that (#480).
  "ai-apps": { title: "Connecting AI apps needs a free account", error: "Create an account to connect AI apps." },
  people: { title: "Inviting people needs a free account", error: "Create an account to invite people." },
  messages: { title: "Messages need a free account", error: "Create an account to send messages." },
  "calendar-feed": { title: "Calendar links need a free account", error: "Create an account to link your calendar." },
  notifications: { title: "Notifications need a free account", error: "Create an account to get notifications." },
};

export function isGuestLimitKind(value: unknown): value is GuestLimitKind {
  return typeof value === "string" && Object.hasOwn(GUEST_LIMITS, value);
}

/** The sign-up pop-up's heading and line for each reason. */
export function guestSignupCopy(reason: GuestSignupReason): { title: string; description: string } {
  // Signing up turns the guest workspace into the account (#459), so nothing made here is lost.
  const description = "It's free, and everything you made here comes with you.";
  if (reason === "signup") return { title: "Keep your work with a free account", description };
  if (isGuestLimitKind(reason)) {
    const limit = GUEST_LIMITS[reason];
    return {
      title: limit === 1 ? `Guest workspaces have ${counted(reason, 1)}` : `You've used your ${limit} guest ${NOUNS[reason][1]}`,
      description: "Sign up free for as many as you like. Everything you made here comes with you.",
    };
  }
  return { title: ACCOUNT_ONLY[reason].title, description };
}

/** The 403 body for a guest past a limit. */
export function guestLimitRefusal(kind: GuestLimitKind): GuestRefusal {
  return {
    error: `Guest workspaces hold ${counted(kind, GUEST_LIMITS[kind])}. Sign up free to add more.`,
    code: GUEST_LIMIT_CODE,
    reason: kind,
  };
}

/** The 403 body for a guest asking for something only accounts can do. */
export function accountRequiredRefusal(reason: keyof typeof ACCOUNT_ONLY): GuestRefusal {
  return { error: ACCOUNT_ONLY[reason].error, code: ACCOUNT_REQUIRED_CODE, reason };
}

/** The sign-up reason in an API answer, when the answer is one of the two refusals above. */
export function guestRefusalReason(body: unknown): GuestSignupReason | null {
  if (!body || typeof body !== "object") return null;
  const { code, reason } = body as { code?: unknown; reason?: unknown };
  if (code !== GUEST_LIMIT_CODE && code !== ACCOUNT_REQUIRED_CODE) return null;
  if (isGuestLimitKind(reason) || (typeof reason === "string" && Object.hasOwn(ACCOUNT_ONLY, reason))) return reason as GuestSignupReason;
  return null;
}
