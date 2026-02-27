# MCP Worker Authentication

**GitHub OAuth 2.1 for the Remote MCP Server**
February 2026

---

## 1. Overview

The Keloia MCP Worker (`mcp-worker/`) is deployed as a Cloudflare Worker with Streamable HTTP transport. It exposes project management tools (docs, kanban, progress) to MCP clients like Claude Code, Claude Desktop, and MCP Inspector.

Starting v3.0, all MCP tool access requires **GitHub OAuth 2.1 authentication**. Unauthenticated requests to `/mcp` receive a `401` with OAuth discovery metadata, and MCP clients automatically initiate the authorization flow.

```
MCP Client                    Keloia MCP Worker                  GitHub
    │                              │                                │
    ├── POST /mcp ────────────────►│                                │
    │◄── 401 + WWW-Authenticate ──│                                │
    │                              │                                │
    ├── POST /register ───────────►│  (dynamic client registration) │
    │◄── client_id ────────────────│                                │
    │                              │                                │
    ├── GET /authorize ───────────►│                                │
    │◄── Approval dialog ─────────│                                │
    │── POST /authorize ──────────►│                                │
    │                              ├── redirect to GitHub ─────────►│
    │                              │◄── callback + code ───────────│
    │                              ├── exchange code for token ────►│
    │                              │◄── access_token ──────────────│
    │◄── redirect with auth code ──│                                │
    │                              │                                │
    ├── POST /token ──────────────►│  (exchange for MCP token)      │
    │◄── access_token + refresh ───│                                │
    │                              │                                │
    ├── POST /mcp (authenticated)─►│  ✓ tools work                  │
```

---

## 2. Architecture

### OAuth Provider Layer

The worker uses `@cloudflare/workers-oauth-provider` as its default export. This library wraps the MCP handler and automatically provides:

- **`/.well-known/oauth-authorization-server`** — OAuth metadata discovery
- **`/register`** — Dynamic client registration (RFC 7591)
- **`/token`** — Token issuance with PKCE support
- **`/authorize`** — Delegated to our GitHub handler

```typescript
// src/index.ts
export default new OAuthProvider({
  apiHandler: KeloiaMCP.serve("/mcp", { binding: "KeloiaMCP" }),
  apiRoute: "/mcp",
  defaultHandler: GitHubHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
```

Requests to `/mcp` are only forwarded to `McpAgent` if they carry a valid access token. Everything else is handled by the OAuth layer.

### GitHub Handler (Hono)

A Hono app (`src/oauth/github-handler.ts`) implements the upstream GitHub OAuth flow:

| Route | Method | Purpose |
|-------|--------|---------|
| `/authorize` | GET | Show approval dialog (or skip if client was previously approved) |
| `/authorize` | POST | User approved — validate CSRF, set approval cookie, redirect to GitHub |
| `/callback` | GET | Exchange GitHub code for token, fetch user identity, complete MCP authorization |

### Token Separation

Two distinct tokens are in play:

| Token | Scope | Used For |
|-------|-------|----------|
| **Server PAT** (`GITHUB_TOKEN`) | Repo write access | MCP tools that write files (create tasks, edit docs) via GitHub Contents API |
| **User OAuth token** (`accessToken` in Props) | `read:user user:email` | Identifying who authenticated — stored in MCP auth token as Props |

Tools continue using the server PAT for all GitHub API operations. The user's OAuth token is only used during the callback to fetch their GitHub profile.

---

## 3. User Identity (Props)

After authentication, the user's identity is encrypted into the MCP access token and available as `this.props` inside `McpAgent`:

```typescript
export type Props = {
  login: string;      // GitHub username
  name: string;       // Display name
  email: string;      // GitHub email (may be empty)
  accessToken: string; // User's GitHub OAuth token (read:user scope only)
};
```

Props are not consumed by tools in v3.0 but are available for future use:
- Audit logging (e.g., `"edited by @enjat"` in commit messages)
- Per-user tool access (e.g., restrict write tools to specific GitHub logins)
- Rate limiting per user

---

## 4. Security

### CSRF Protection
The approval dialog includes a `__Host-CSRF_TOKEN` cookie + hidden form field. The POST handler validates they match before proceeding.

### State Binding
OAuth state tokens are stored in KV (one-time use, 10-minute TTL) and bound to the browser session via a `__Host-CONSENTED_STATE` cookie containing a SHA-256 hash of the state. This prevents CSRF attacks where an attacker's state token is injected into a victim's flow.

### Client Approval Memory
Once a user approves an MCP client, the client ID is stored in a signed `__Host-APPROVED_CLIENTS` cookie (HMAC-SHA256, 30-day expiry). Subsequent authorizations from the same client skip the approval dialog.

### Cookie Security
All cookies use `HttpOnly; Secure; SameSite=Lax` and the `__Host-` prefix (requires Secure, no Domain, Path=/).

---

## 5. File Structure

```
mcp-worker/src/
├── index.ts                      # OAuthProvider default export + McpAgent
├── github.ts                     # Env interface (with OAuth bindings) + Props type
├── oauth/
│   ├── github-handler.ts         # Hono app: /authorize, /callback routes
│   ├── utils.ts                  # getUpstreamAuthorizeUrl, fetchUpstreamAuthToken
│   └── workers-oauth-utils.ts    # CSRF, state management, approval dialog, cookie signing
└── tools/
    ├── read.ts                   # Read-only MCP tools
    ├── write.ts                  # Write MCP tools
    └── docs.ts                   # Documentation MCP tools
```

---

## 6. Configuration

### Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `GITHUB_CLIENT_ID` | Secret | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | Secret | GitHub OAuth App client secret |
| `COOKIE_ENCRYPTION_KEY` | Secret | HMAC key for signing approval cookies (hex, 32 bytes) |
| `GITHUB_TOKEN` | Secret | Server PAT for repo read/write (unchanged from v2) |
| `OAUTH_KV` | KV binding | Stores OAuth state tokens (wrangler.toml) |

### Local Development

Create `mcp-worker/.dev.vars` (gitignored):

```
GITHUB_CLIENT_ID=<dev-oauth-app-id>
GITHUB_CLIENT_SECRET=<dev-oauth-app-secret>
COOKIE_ENCRYPTION_KEY=<openssl rand -hex 32>
```

### GitHub OAuth Apps

Create two OAuth Apps at https://github.com/settings/developers:

| Environment | Callback URL |
|-------------|-------------|
| Development | `http://localhost:8788/callback` |
| Production | `https://keloia-mcp.<subdomain>.workers.dev/callback` |

### Production Secrets

```bash
cd mcp-worker
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put COOKIE_ENCRYPTION_KEY
```

### KV Namespace

```bash
cd mcp-worker
npx wrangler kv namespace create OAUTH_KV
# Copy the returned ID into wrangler.toml
```

---

## 7. Dependencies Added

| Package | Version | Purpose |
|---------|---------|---------|
| `@cloudflare/workers-oauth-provider` | 0.2.4 | OAuth 2.1 provider framework for Workers |
| `hono` | 4.12.3 | Lightweight router for the GitHub OAuth handler |

No `octokit` — user info is fetched with plain `fetch("https://api.github.com/user")` to keep the bundle small.

---

## 8. Verification

After setup, verify the following:

1. **`pnpm typecheck`** passes
2. **`wrangler dev`** starts without errors
3. **`/.well-known/oauth-authorization-server`** returns valid JSON metadata
4. **MCP Inspector** connecting to `http://localhost:8788/mcp` triggers the GitHub OAuth flow
5. **After authenticating**, all tools work as before
6. **Unauthenticated requests** to `/mcp` return 401
