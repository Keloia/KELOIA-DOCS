import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "keloia",
    version: "1.0.0",
  });
  // Tools registered here in phases 4-5
  return server;
}
