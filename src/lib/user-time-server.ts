import "server-only";
import { cookies } from "next/headers";
import { TIME_ZONE_COOKIE, timeZoneFromCookie, toWallClock } from "@/lib/user-time";

/** The browser's time zone from the `tz` cookie, or null when it isn't set or valid. */
export async function getUserTimeZone() {
  const cookieStore = await cookies();
  return timeZoneFromCookie(cookieStore.get(TIME_ZONE_COOKIE)?.value);
}

/** Now, as the signed-in user's wall clock; see `@/lib/user-time`. */
export async function getUserNow() {
  return toWallClock(await getUserTimeZone());
}
