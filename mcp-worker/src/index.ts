import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";
import { registerDocTools } from "./tools/docs.js";
import type { Env } from "./github.js";

// Env with DO binding
interface WorkerEnv extends Env {
  KeloiaMCP: DurableObjectNamespace;
}

export class KeloiaMCP extends McpAgent<WorkerEnv, {}, {}> {
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

// Wrap the default handler to intercept OAuth discovery requests.
// MCP clients probe /.well-known/oauth-authorization-server before connecting.
// This server doesn't use OAuth, so return 404 to let clients skip auth.
const mcpHandler = KeloiaMCP.mount("/mcp", { binding: "KeloiaMCP" });

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/.well-known/")) {
      return new Response(null, { status: 404 });
    }
    return mcpHandler.fetch(request, env, ctx);
  },
};
