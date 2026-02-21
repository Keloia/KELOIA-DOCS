import { createServer } from "./server.js";
import { connectStdio } from "./transport.js";
import { logPaths } from "./paths.js";

// Log resolved paths to stderr at startup (MCP-03 verification)
logPaths();

const server = createServer();
await connectStdio(server);
