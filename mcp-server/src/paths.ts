import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// dist/paths.js → dirname = dist/ → .. = mcp-server/ → .. = repo root
export const REPO_ROOT = join(__dirname, "..", "..");
export const DOCS_DIR = join(REPO_ROOT, "data", "docs");
export const KANBAN_DIR = join(REPO_ROOT, "data", "kanban");
export const PROGRESS_DIR = join(REPO_ROOT, "data", "progress");

/** Log resolved paths to stderr and warn if directories don't exist. */
export function logPaths(): void {
  console.error("[keloia-mcp] REPO_ROOT:", REPO_ROOT);
  console.error("[keloia-mcp] DOCS_DIR:", DOCS_DIR);
  console.error("[keloia-mcp] KANBAN_DIR:", KANBAN_DIR);
  console.error("[keloia-mcp] PROGRESS_DIR:", PROGRESS_DIR);

  for (const [name, dir] of [["DOCS_DIR", DOCS_DIR], ["KANBAN_DIR", KANBAN_DIR], ["PROGRESS_DIR", PROGRESS_DIR]] as const) {
    if (!existsSync(dir)) {
      console.error(`[keloia-mcp] WARNING: ${name} does not exist: ${dir}`);
    }
  }
}
