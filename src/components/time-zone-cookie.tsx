"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { TIME_ZONE_COOKIE } from "@/lib/user-time";

/**
 * Keeps the `tz` cookie equal to the browser's time zone, so server pages can
 * compute "today" for the user. Refreshes server data when the cookie changes.
 */
export function TimeZoneCookie() {
  const router = useRouter();

  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timeZone) return;

    const saved = document.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith(`${TIME_ZONE_COOKIE}=`))
      ?.slice(TIME_ZONE_COOKIE.length + 1);
    if (saved && decodeURIComponent(saved) === timeZone) return;

    document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(timeZone)}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [router]);

  return null;
}
