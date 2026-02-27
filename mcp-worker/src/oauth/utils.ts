/**
 * Upstream OAuth helpers for the GitHub authorization flow.
 */

/**
 * Constructs the GitHub OAuth authorize URL.
 */
export function getUpstreamAuthorizeUrl({
  upstream_url,
  client_id,
  scope,
  redirect_uri,
  state,
}: {
  upstream_url: string;
  client_id: string;
  scope: string;
  redirect_uri: string;
  state?: string;
}): string {
  const url = new URL(upstream_url);
  url.searchParams.set("client_id", client_id);
  url.searchParams.set("redirect_uri", redirect_uri);
  url.searchParams.set("scope", scope);
  if (state) url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  return url.href;
}

/**
 * Exchanges a GitHub authorization code for an access token.
 * Returns [accessToken, null] on success or [null, errorResponse] on failure.
 */
export async function fetchUpstreamAuthToken({
  client_id,
  client_secret,
  code,
  redirect_uri,
  upstream_url,
}: {
  code: string | undefined;
  upstream_url: string;
  client_secret: string;
  redirect_uri: string;
  client_id: string;
}): Promise<[string, null] | [null, Response]> {
  if (!code) {
    return [null, new Response("Missing code", { status: 400 })];
  }

  const resp = await fetch(upstream_url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id, client_secret, code, redirect_uri }).toString(),
  });

  if (!resp.ok) {
    return [null, new Response("Failed to fetch access token", { status: 500 })];
  }

  const body = await resp.formData();
  const accessToken = body.get("access_token") as string;
  if (!accessToken) {
    return [null, new Response("Missing access token", { status: 400 })];
  }

  return [accessToken, null];
}
