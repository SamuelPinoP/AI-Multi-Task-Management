// Browser side of push notifications (SMART-08): ask, subscribe with the
// server's public VAPID key, and tell the server; or undo all of that.
// The service worker (public/sw.js) shows what arrives. It is registered in
// production builds only, so push can't be turned on under `next dev`.

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** The base64url VAPID key as the bytes `pushManager.subscribe` wants. */
function keyBytes(base64url: string) {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

export async function currentPushSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

/** Asks for permission (the browser's own prompt), subscribes this browser and saves it on the server. */
export async function turnOnPush(publicKey: string) {
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) throw new Error("Browser notifications need the app's service worker. Reload the page and try again.");
  const permission = await Notification.requestPermission();
  if (permission === "denied") throw new Error("Notifications are blocked for this site. Allow them in your browser's site settings.");
  if (permission !== "granted") throw new Error("Notifications weren't allowed.");
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  const response = await fetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Couldn't turn on browser notifications.");
  }
}

/**
 * Stops push to this browser: the server forgets it (when signed in) and the
 * browser unsubscribes, so a signed-out device gets nothing for the last user.
 */
export async function turnOffPush() {
  const subscription = await currentPushSubscription().catch(() => null);
  if (!subscription) return;
  await fetch("/api/push", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => false);
}
