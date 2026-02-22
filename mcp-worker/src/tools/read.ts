// Read tools: keloia_list_docs, keloia_read_doc, keloia_get_kanban, keloia_get_progress
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as github from "../github.js";
import type { Env } from "../github.js";

export function registerReadTools(server: McpServer, env: Env): void {

  // READ-01: List all available documentation files
  server.registerTool(
    "keloia_list_docs",
    {
      description:
        "Lists all available documentation files in the keloia docs library. Returns an array of slugs and titles. Use slugs with keloia_read_doc to fetch document content.",
    },
    async () => {
      try {
        const index = await github.readJson<{ docs: Array<{ slug: string; title: string }> }>(
          env, "data/docs/index.json"
        );
        if (!index) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: "Failed to read docs index: file not found" }],
          };
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(index.docs, null, 2) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Failed to read docs index: ${String(err)}` }],
        };
      }
    }
  );

  // READ-02: Read a single documentation file by slug, with optional pagination
  server.registerTool(
    "keloia_read_doc",
    {
      description:
        "Reads the full markdown content of a keloia documentation file by its slug. Use keloia_list_docs first to discover valid slugs. Supports optional pagination via max_tokens (character limit) and offset (character start position) for large documents.",
      inputSchema: {
        slug: z.string().describe("Document slug (e.g. 'architecture', 'value-proposition')"),
        max_tokens: z.number().optional().describe("Maximum characters to return"),
        offset: z.number().optional().describe("Character offset to start from"),
      },
    },
    async ({ slug, max_tokens, offset }) => {
      try {
        const index = await github.readJson<{ docs: Array<{ slug: string; title: string }> }>(
          env, "data/docs/index.json"
        );
        if (!index) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: "Failed to read docs index: file not found" }],
          };
        }
        const known = index.docs.map((d) => d.slug);
        if (!known.includes(slug)) {
          return {
            isError: true,
            content: [{
              type: "text" as const,
              text: `Document not found: no doc with slug "${slug}". Available slugs: ${known.join(", ")}`,
            }],
          };
        }
        let content = await github.readFile(env, `data/docs/${slug}.md`);
        if (content === null) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `File not found on disk for slug "${slug}"` }],
          };
        }
        if (offset !== undefined || max_tokens !== undefined) {
          const start = offset ?? 0;
          content =
            max_tokens !== undefined
              ? content.slice(start, start + max_tokens)
              : content.slice(start);
        }
        return {
          content: [{ type: "text" as const, text: content }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Failed to read doc "${slug}": ${String(err)}` }],
        };
      }
    }
  );

  // READ-03: Return the complete kanban board with tasks denormalized into columns
  server.registerTool(
    "keloia_get_kanban",
    {
      description:
        "Returns the complete keloia kanban board with all columns and their tasks fully denormalized. Each column object contains an array of task objects (id, title, column, description, assignee). Use this to view all work items and their current status.",
    },
    async () => {
      try {
        const index = await github.readJson<{ columns: string[]; tasks: string[] }>(
          env, "data/kanban/index.json"
        );
        if (!index) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: "Failed to read kanban index: file not found" }],
          };
        }
        const allTasks = await Promise.all(
          index.tasks.map((taskId) =>
            github.readJson<{ column: string; [key: string]: unknown }>(env, `data/kanban/${taskId}.json`)
          )
        );
        const board = index.columns.map((col) => ({
          column: col,
          tasks: allTasks.filter((t): t is NonNullable<typeof t> => t !== null && t.column === col),
        }));
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ columns: board }, null, 2) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Failed to read kanban board: ${String(err)}` }],
        };
      }
    }
  );

  // READ-04: Return milestone progress for all project phases
  server.registerTool(
    "keloia_get_progress",
    {
      description:
        "Returns milestone progress for all keloia project phases. Each milestone includes its status (done/in-progress/pending), total and completed task counts, and descriptive notes. Use this to check which phases are complete and what is in progress.",
    },
    async () => {
      try {
        const index = await github.readJson<{ milestones: string[] }>(
          env, "data/progress/index.json"
        );
        if (!index) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: "Failed to read progress index: file not found" }],
          };
        }
        const milestones = await Promise.all(
          index.milestones.map((id) =>
            github.readJson(env, `data/progress/${id}.json`)
          )
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ milestones: milestones.filter(Boolean) }, null, 2) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Failed to read progress data: ${String(err)}` }],
        };
      }
    }
  );
}
