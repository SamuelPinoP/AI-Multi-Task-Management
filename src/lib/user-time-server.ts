import "server-only";
import { cookies } from "next/headers";
import { TIME_ZONE_COOKIE, toWallClock } from "@/lib/user-time";

/** Now, as the signed-in user's wall clock; see `@/lib/user-time`. */
export async function getUserNow() {
  const cookieStore = await cookies();
  const value = cookieStore.get(TIME_ZONE_COOKIE)?.value;
  return toWallClock(value ? decodeURIComponent(value) : null);
}
