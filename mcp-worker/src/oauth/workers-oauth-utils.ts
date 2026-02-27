/**
 * OAuth utility functions with CSRF and state validation security.
 * Adapted from https://github.com/cloudflare/ai/blob/main/demos/remote-mcp-github-oauth/src/workers-oauth-utils.ts
 */

import type { AuthRequest, ClientInfo } from "@cloudflare/workers-oauth-provider";

// ── Error ────────────────────────────────────────────────────────────────────

export class OAuthError extends Error {
  constructor(
    public code: string,
    public description: string,
    public statusCode = 400,
  ) {
    super(description);
    this.name = "OAuthError";
  }

  toResponse(): Response {
    return new Response(
      JSON.stringify({ error: this.code, error_description: this.description }),
      { status: this.statusCode, headers: { "Content-Type": "application/json" } },
    );
  }
}

// ── CSRF ─────────────────────────────────────────────────────────────────────

export function generateCSRFProtection(): { token: string; setCookie: string } {
  const name = "__Host-CSRF_TOKEN";
  const token = crypto.randomUUID();
  return { token, setCookie: `${name}=${token}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=600` };
}

export function validateCSRFToken(formData: FormData, request: Request): void {
  const name = "__Host-CSRF_TOKEN";
  const tokenFromForm = formData.get("csrf_token");
  if (!tokenFromForm || typeof tokenFromForm !== "string") {
    throw new OAuthError("invalid_request", "Missing CSRF token in form data");
  }

  const cookies = (request.headers.get("Cookie") || "").split(";").map((c) => c.trim());
  const cookie = cookies.find((c) => c.startsWith(`${name}=`));
  const tokenFromCookie = cookie ? cookie.substring(name.length + 1) : null;

  if (!tokenFromCookie || tokenFromForm !== tokenFromCookie) {
    throw new OAuthError("invalid_request", "CSRF token mismatch");
  }
}

// ── OAuth State ──────────────────────────────────────────────────────────────

export async function createOAuthState(
  oauthReqInfo: AuthRequest,
  kv: KVNamespace,
  stateTTL = 600,
): Promise<{ stateToken: string }> {
  const stateToken = crypto.randomUUID();
  await kv.put(`oauth:state:${stateToken}`, JSON.stringify(oauthReqInfo), { expirationTtl: stateTTL });
  return { stateToken };
}

async function hashState(state: string): Promise<string> {
  const data = new TextEncoder().encode(state);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function bindStateToSession(stateToken: string): Promise<{ setCookie: string }> {
  const name = "__Host-CONSENTED_STATE";
  const hash = await hashState(stateToken);
  return { setCookie: `${name}=${hash}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=600` };
}

export async function validateOAuthState(
  request: Request,
  kv: KVNamespace,
): Promise<{ oauthReqInfo: AuthRequest; clearCookie: string }> {
  const name = "__Host-CONSENTED_STATE";
  const url = new URL(request.url);
  const stateFromQuery = url.searchParams.get("state");

  if (!stateFromQuery) {
    throw new OAuthError("invalid_request", "Missing state parameter");
  }

  const stored = await kv.get(`oauth:state:${stateFromQuery}`);
  if (!stored) {
    throw new OAuthError("invalid_request", "Invalid or expired state");
  }

  // Validate session binding
  const cookies = (request.headers.get("Cookie") || "").split(";").map((c) => c.trim());
  const cookie = cookies.find((c) => c.startsWith(`${name}=`));
  const consentedHash = cookie ? cookie.substring(name.length + 1) : null;

  if (!consentedHash) {
    throw new OAuthError("invalid_request", "Missing session binding cookie");
  }

  const stateHash = await hashState(stateFromQuery);
  if (stateHash !== consentedHash) {
    throw new OAuthError("invalid_request", "State token does not match session");
  }

  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = JSON.parse(stored) as AuthRequest;
  } catch {
    throw new OAuthError("server_error", "Invalid state data", 500);
  }

  // Delete state (one-time use)
  await kv.delete(`oauth:state:${stateFromQuery}`);
  const clearCookie = `${name}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`;
  return { oauthReqInfo, clearCookie };
}

// ── Approved Clients Cookie ──────────────────────────────────────────────────

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signData(data: string, secret: string): Promise<string> {
  const key = await importKey(secret);
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifySignature(sig: string, data: string, secret: string): Promise<boolean> {
  const key = await importKey(secret);
  try {
    const sigBytes = new Uint8Array(sig.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
    return crypto.subtle.verify("HMAC", key, sigBytes.buffer, new TextEncoder().encode(data));
  } catch {
    return false;
  }
}

async function getApprovedClientsFromCookie(
  request: Request,
  cookieSecret: string,
): Promise<string[] | null> {
  const name = "__Host-APPROVED_CLIENTS";
  const header = request.headers.get("Cookie");
  if (!header) return null;

  const cookie = header.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  if (!cookie) return null;

  const value = cookie.substring(name.length + 1);
  const parts = value.split(".");
  if (parts.length !== 2) return null;

  const [sigHex, b64Payload] = parts;
  const payload = atob(b64Payload);
  if (!(await verifySignature(sigHex, payload, cookieSecret))) return null;

  try {
    const parsed = JSON.parse(payload);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === "string") ? parsed : null;
  } catch {
    return null;
  }
}

export async function isClientApproved(
  request: Request,
  clientId: string,
  cookieSecret: string,
): Promise<boolean> {
  const clients = await getApprovedClientsFromCookie(request, cookieSecret);
  return clients?.includes(clientId) ?? false;
}

export async function addApprovedClient(
  request: Request,
  clientId: string,
  cookieSecret: string,
): Promise<string> {
  const name = "__Host-APPROVED_CLIENTS";
  const existing = (await getApprovedClientsFromCookie(request, cookieSecret)) || [];
  const updated = Array.from(new Set([...existing, clientId]));
  const payload = JSON.stringify(updated);
  const sig = await signData(payload, cookieSecret);
  return `${name}=${sig}.${btoa(payload)}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=2592000`;
}

// ── Approval Dialog ──────────────────────────────────────────────────────────

function sanitizeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if ((code >= 0x00 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) return "";
  }
  let parsed: URL;
  try { parsed = new URL(trimmed); } catch { return ""; }
  if (!["https", "http"].includes(parsed.protocol.slice(0, -1).toLowerCase())) return "";
  return trimmed;
}

export interface ApprovalDialogOptions {
  client: ClientInfo | null;
  server: { name: string; logo?: string; description?: string };
  state: Record<string, unknown>;
  csrfToken: string;
  setCookie: string;
}

export function renderApprovalDialog(request: Request, options: ApprovalDialogOptions): Response {
  const { client, server, state, csrfToken, setCookie } = options;
  const encodedState = btoa(JSON.stringify(state));
  const serverName = sanitizeText(server.name);
  const clientName = client?.clientName ? sanitizeText(client.clientName) : "Unknown MCP Client";
  const serverDescription = server.description ? sanitizeText(server.description) : "";
  const logoUrl = server.logo ? sanitizeText(sanitizeUrl(server.logo)) : "";

  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${clientName} | Authorization Request</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f9fafb; margin: 0; padding: 2rem; color: #333; }
    .card { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); padding: 2rem; }
    .header { text-align: center; margin-bottom: 1.5rem; }
    .logo { width: 48px; height: 48px; border-radius: 8px; }
    h1 { font-size: 1.25rem; margin: 0.5rem 0; }
    .desc { color: #666; font-size: 0.9rem; }
    .alert { font-size: 1.1rem; text-align: center; margin: 1rem 0; }
    .actions { display: flex; gap: 1rem; justify-content: flex-end; margin-top: 1.5rem; }
    .btn { padding: 0.6rem 1.2rem; border-radius: 6px; cursor: pointer; font-size: 0.95rem; border: none; }
    .btn-primary { background: #0070f3; color: #fff; }
    .btn-secondary { background: transparent; border: 1px solid #ddd; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      ${logoUrl ? `<img src="${logoUrl}" alt="" class="logo"><br>` : ""}
      <h1>${serverName}</h1>
      ${serverDescription ? `<p class="desc">${serverDescription}</p>` : ""}
    </div>
    <p class="alert"><strong>${clientName}</strong> is requesting access</p>
    <form method="post" action="${new URL(request.url).pathname}">
      <input type="hidden" name="state" value="${encodedState}">
      <input type="hidden" name="csrf_token" value="${csrfToken}">
      <div class="actions">
        <button type="button" class="btn btn-secondary" onclick="window.history.back()">Cancel</button>
        <button type="submit" class="btn btn-primary">Approve</button>
      </div>
    </form>
  </div>
</body>
</html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Set-Cookie": setCookie,
        "Content-Security-Policy": "frame-ancestors 'none'",
        "X-Frame-Options": "DENY",
      },
    },
  );
}
