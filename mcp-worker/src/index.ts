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

export default KeloiaMCP.mount("/mcp");
