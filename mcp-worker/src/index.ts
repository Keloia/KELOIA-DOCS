import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";
import { registerDocTools } from "./tools/docs.js";
import { GitHubHandler } from "./oauth/github-handler.js";
import type { Env, Props } from "./github.js";

interface WorkerEnv extends Env {
  KeloiaMCP: DurableObjectNamespace;
}

export class KeloiaMCP extends McpAgent<WorkerEnv, Record<string, never>, Props> {
  server = new McpServer({
    name: "keloia",
    version: "1.0.0",
  });

  async init() {
    registerReadTools(this.server, this.env);
    registerWriteTools(this.server, this.env);
    registerDocTools(this.server, this.env);
  }
}

export default new OAuthProvider({
  apiHandler: KeloiaMCP.serve("/mcp", { binding: "KeloiaMCP" }),
  apiRoute: "/mcp",
  defaultHandler: GitHubHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
