import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";
import { registerDocTools } from "./tools/docs.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "keloia",
    version: "1.0.0",
  });
  registerReadTools(server);
  registerWriteTools(server);
  registerDocTools(server);
  return server;
}
