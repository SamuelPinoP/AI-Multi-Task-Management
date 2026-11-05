export const DEMO_USER_EMAIL = "samuel@example.com";
export const SESSION_COOKIE_NAME = "ai_multi_task_session";

export const GUEST_USER_EMAIL_DOMAIN = "guest.ai-multi-task.local";

/** Set by src/proxy.ts on every page request: the address asked for, so logging in can come back to it (#354). */
export const REQUEST_PATH_HEADER = "x-ai-multi-path";

/** What a failed login typed in "Email or username", kept briefly to fill the form again (#351). */
export const LOGIN_IDENTIFIER_COOKIE = "ai_multi_task_login_identifier";
/** The longest email address there can be, so also the longest thing worth typing there. */
export const LOGIN_IDENTIFIER_MAX_LENGTH = 254;
