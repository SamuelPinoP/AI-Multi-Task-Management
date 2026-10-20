import "server-only";
import { cookies } from "next/headers";
import { isValidTimeZone, TIME_ZONE_COOKIE, toWallClock } from "@/lib/user-time";

/** The browser's time zone from the `tz` cookie, or null when it isn't set or valid. */
export async function getUserTimeZone() {
  const cookieStore = await cookies();
  const value = cookieStore.get(TIME_ZONE_COOKIE)?.value;
  const timeZone = value ? decodeURIComponent(value) : null;
  return isValidTimeZone(timeZone) ? timeZone : null;
}

/** Now, as the signed-in user's wall clock; see `@/lib/user-time`. */
export async function getUserNow() {
  return toWallClock(await getUserTimeZone());
}
