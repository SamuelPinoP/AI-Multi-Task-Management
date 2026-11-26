import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ConsentCard, ConsentProblem, GuestConsentCard } from "@/components/oauth/consent-card";
import { requirePageUser } from "@/lib/auth";
import { isGoogleSignInEnabled } from "@/lib/google-auth";
import { appTile, isMcpEnabled, knownApp } from "@/lib/mcp/connect";
import { OAUTH_PATHS, oauthOrigin } from "@/lib/mcp/oauth";
import { oauthServer } from "@/lib/mcp/oauth-routes";
import { clientIpFrom } from "@/lib/rate-limit-core";

export const metadata: Metadata = {
  title: "Connect an app · AI Multi",
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

/** The link's parameters as the app sent them, repeats included, so a repeated one is refused. */
function toSearchParams(values: SearchParams) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(name, item);
  }
  return params;
}

/**
 * Where an AI app sends the person to connect (#477, design 3C): the OAuth 2.1 authorization
 * endpoint. Signed-out visitors log in first and come back (src/proxy.ts), and an unconfirmed email
 * is confirmed first (requirePageUser). A link that's wrong about the app itself shows why; any
 * other mistake goes back to the app as an OAuth error. Off unless MCP_ENABLED is "true".
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (!isMcpEnabled(process.env)) notFound();
  const user = await requirePageUser();
  const params = toSearchParams(await searchParams);
  const requestHeaders = await headers();
  const consent = await oauthServer.prepareConsent(params, {
    origin: oauthOrigin(process.env, requestHeaders),
    ip: clientIpFrom(requestHeaders),
  });
  if (consent.kind === "redirect") redirect(consent.location);
  if (consent.kind === "fatal") return <ConsentProblem message={consent.message} />;

  const app = { ...consent.app, tile: knownApp(consent.app)?.tile ?? appTile(consent.app.name) };
  const fields = [...params.entries()];
  if (user.isGuest) {
    return <GuestConsentCard app={app} fields={fields} next={`${OAUTH_PATHS.authorize}?${params}`} googleSignIn={isGoogleSignInEnabled()} />;
  }
  return <ConsentCard app={app} signedInAs={user.name?.trim() || user.email} wantsWrite={consent.request.scopes.includes("write")} fields={fields} />;
}
