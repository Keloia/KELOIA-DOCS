/**
 * Hono-based GitHub OAuth handler for the MCP authorization flow.
 *
 * Routes:
 *   GET  /authorize — Show approval dialog or redirect to GitHub if already approved
 *   POST /authorize — User approved, redirect to GitHub
 *   GET  /callback  — Exchange code for token, fetch user info, complete authorization
 */

import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { fetchUpstreamAuthToken, getUpstreamAuthorizeUrl } from "./utils.js";
import {
  addApprovedClient,
  bindStateToSession,
  createOAuthState,
  generateCSRFProtection,
  isClientApproved,
  OAuthError,
  renderApprovalDialog,
  validateCSRFToken,
  validateOAuthState,
} from "./workers-oauth-utils.js";
import type { Env, Props } from "../github.js";

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

// ── GET /authorize ───────────────────────────────────────────────────────────

app.get("/authorize", async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  const { clientId } = oauthReqInfo;
  if (!clientId) {
    return c.text("Invalid request", 400);
  }

  // Skip approval dialog if client was previously approved
  if (await isClientApproved(c.req.raw, clientId, c.env.COOKIE_ENCRYPTION_KEY)) {
    const { stateToken } = await createOAuthState(oauthReqInfo, c.env.OAUTH_KV);
    const { setCookie: sessionCookie } = await bindStateToSession(stateToken);
    return redirectToGithub(c.req.raw, c.env, stateToken, { "Set-Cookie": sessionCookie });
  }

  // Show approval dialog
  const { token: csrfToken, setCookie } = generateCSRFProtection();
  return renderApprovalDialog(c.req.raw, {
    client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
    csrfToken,
    server: {
      name: "Keloia MCP Server",
      description: "Authenticate with GitHub to access Keloia project management tools.",
    },
    setCookie,
    state: { oauthReqInfo },
  });
});

// ── POST /authorize ──────────────────────────────────────────────────────────

app.post("/authorize", async (c) => {
  try {
    const formData = await c.req.raw.formData();
    validateCSRFToken(formData, c.req.raw);

    const encodedState = formData.get("state");
    if (!encodedState || typeof encodedState !== "string") {
      return c.text("Missing state", 400);
    }

    let state: { oauthReqInfo?: AuthRequest };
    try {
      state = JSON.parse(atob(encodedState));
    } catch {
      return c.text("Invalid state data", 400);
    }

    if (!state.oauthReqInfo?.clientId) {
      return c.text("Invalid request", 400);
    }

    // Remember approval and redirect to GitHub
    const approvedCookie = await addApprovedClient(
      c.req.raw,
      state.oauthReqInfo.clientId,
      c.env.COOKIE_ENCRYPTION_KEY,
    );
    const { stateToken } = await createOAuthState(state.oauthReqInfo, c.env.OAUTH_KV);
    const { setCookie: sessionCookie } = await bindStateToSession(stateToken);

    const headers = new Headers();
    headers.append("Set-Cookie", approvedCookie);
    headers.append("Set-Cookie", sessionCookie);

    return redirectToGithub(c.req.raw, c.env, stateToken, Object.fromEntries(headers));
  } catch (error: unknown) {
    if (error instanceof OAuthError) return error.toResponse();
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.text(`Internal server error: ${message}`, 500);
  }
});

// ── GET /callback ────────────────────────────────────────────────────────────

app.get("/callback", async (c) => {
  // Validate state + session binding
  let oauthReqInfo: AuthRequest;
  let clearSessionCookie: string;

  try {
    const result = await validateOAuthState(c.req.raw, c.env.OAUTH_KV);
    oauthReqInfo = result.oauthReqInfo;
    clearSessionCookie = result.clearCookie;
  } catch (error: unknown) {
    if (error instanceof OAuthError) return error.toResponse();
    return c.text("Internal server error", 500);
  }

  if (!oauthReqInfo.clientId) {
    return c.text("Invalid OAuth request data", 400);
  }

  // Exchange code for access token
  const [accessToken, errResponse] = await fetchUpstreamAuthToken({
    client_id: c.env.GITHUB_CLIENT_ID,
    client_secret: c.env.GITHUB_CLIENT_SECRET,
    code: c.req.query("code"),
    redirect_uri: new URL("/callback", c.req.url).href,
    upstream_url: "https://github.com/login/oauth/access_token",
  });
  if (errResponse) return errResponse;

  // Fetch user info from GitHub (plain fetch, no octokit)
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "keloia-mcp-worker",
    },
  });
  if (!userRes.ok) {
    return c.text("Failed to fetch GitHub user info", 500);
  }
  const user = (await userRes.json()) as { login: string; name: string | null; email: string | null };

  // Complete the MCP OAuth authorization
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: user.login,
    metadata: { label: user.name || user.login },
    scope: oauthReqInfo.scope,
    props: {
      login: user.login,
      name: user.name || user.login,
      email: user.email || "",
      accessToken,
    } as Props,
  });

  const headers = new Headers({ Location: redirectTo });
  if (clearSessionCookie) {
    headers.set("Set-Cookie", clearSessionCookie);
  }

  return new Response(null, { status: 302, headers });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function redirectToGithub(
  request: Request,
  env: Env & { OAUTH_PROVIDER: OAuthHelpers },
  stateToken: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(null, {
    status: 302,
    headers: {
      ...extraHeaders,
      Location: getUpstreamAuthorizeUrl({
        client_id: env.GITHUB_CLIENT_ID,
        redirect_uri: new URL("/callback", request.url).href,
        scope: "read:user user:email",
        state: stateToken,
        upstream_url: "https://github.com/login/oauth/authorize",
      }),
    },
  });
}

export const GitHubHandler = app;
