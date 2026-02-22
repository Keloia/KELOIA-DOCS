// Write tools: keloia_add_task, keloia_move_task, keloia_update_progress
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as github from "../github.js";
import type { Env } from "../github.js";

// ── Constants ────────────────────────────────────────────────────────────────

const VALID_COLUMNS = ["Backlog", "In Progress", "Done"] as const;
const VALID_STATUSES = ["pending", "in-progress", "done"] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function nextTaskId(existingIds: string[]): string {
  if (existingIds.length === 0) return "task-001";
  const nums = existingIds.map((id) => {
    const match = id.match(/(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
  });
  return "task-" + String(Math.max(...nums) + 1).padStart(3, "0");
}

// ── Tool registration ────────────────────────────────────────────────────────

export function registerWriteTools(server: McpServer, env: Env): void {

  // WRITE-01: Create a new task on the kanban board
  server.registerTool(
    "keloia_add_task",
    {
      description:
        "Creates a new task on the keloia kanban board. Writes a new task file and updates the kanban index. Returns the created task object with its generated ID. Provide a title; column defaults to Backlog.",
      inputSchema: {
        title: z.string().min(1).describe("Task title (required)"),
        column: z.enum(VALID_COLUMNS).default("Backlog").describe("Column to place task in (default: Backlog)"),
        description: z.string().optional().describe("Optional task description"),
        assignee: z.string().optional().describe("Optional assignee name"),
      },
    },
    async ({ title, column, description, assignee }) => {
      try {
        const index = await github.readJson<{
          schemaVersion: number; columns: string[]; tasks: string[];
        }>(env, "data/kanban/index.json");
        if (!index) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: "Failed to read kanban index: file not found" }],
          };
        }

        const id = nextTaskId(index.tasks);
        const task = {
          id,
          title,
          column,
          description: description ?? null,
          assignee: assignee ?? null,
        };

        // Write task file first
        await github.writeFile(
          env,
          `data/kanban/${id}.json`,
          JSON.stringify(task, null, 2),
          `mcp: add task ${id}`,
        );

        // Then update index — need SHA for update
        const indexSha = await github.getFileSha(env, "data/kanban/index.json");
        await github.writeFile(
          env,
          "data/kanban/index.json",
          JSON.stringify({ ...index, tasks: [...index.tasks, id] }, null, 2),
          `mcp: update kanban index for ${id}`,
          indexSha,
        );

        return {
          content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Failed to add task: ${String(err)}` }],
        };
      }
    }
  );

  // WRITE-02: Move an existing task to a different column
  server.registerTool(
    "keloia_move_task",
    {
      description:
        "Moves an existing keloia kanban task to a different column. Updates the task file. Returns the updated task object.",
      inputSchema: {
        id: z.string().describe("Task ID (e.g. 'task-001')"),
        column: z.enum(VALID_COLUMNS).describe("Target column"),
      },
    },
    async ({ id, column }) => {
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

        if (!index.tasks.includes(id)) {
          return {
            isError: true,
            content: [{
              type: "text" as const,
              text: `Task not found: "${id}". Known tasks: ${index.tasks.join(", ")}`,
            }],
          };
        }

        const existing = await github.readJson<Record<string, unknown>>(
          env, `data/kanban/${id}.json`
        );
        if (!existing) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Task file not found: ${id}.json` }],
          };
        }

        const updated = { ...existing, column };
        const sha = await github.getFileSha(env, `data/kanban/${id}.json`);
        await github.writeFile(
          env,
          `data/kanban/${id}.json`,
          JSON.stringify(updated, null, 2),
          `mcp: move ${id} to ${column}`,
          sha,
        );

        return {
          content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Failed to move task: ${String(err)}` }],
        };
      }
    }
  );

  // WRITE-03: Merge provided fields into an existing milestone file
  server.registerTool(
    "keloia_update_progress",
    {
      description:
        "Updates fields on a keloia milestone. Merges only the provided fields into the existing milestone file. Returns the updated milestone object.",
      inputSchema: {
        id: z.string().describe("Milestone ID (e.g. 'milestone-01')"),
        status: z.enum(VALID_STATUSES).optional().describe("New status value"),
        tasksTotal: z.number().int().min(0).optional().describe("Total task count"),
        tasksCompleted: z.number().int().min(0).optional().describe("Completed task count"),
        notes: z.string().nullable().optional().describe("Milestone notes (can be null)"),
      },
    },
    async ({ id, status, tasksTotal, tasksCompleted, notes }) => {
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

        if (!index.milestones.includes(id)) {
          return {
            isError: true,
            content: [{
              type: "text" as const,
              text: `Milestone not found: "${id}". Known: ${index.milestones.join(", ")}`,
            }],
          };
        }

        const existing = await github.readJson<Record<string, unknown>>(
          env, `data/progress/${id}.json`
        );
        if (!existing) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Milestone file not found: ${id}.json` }],
          };
        }

        const updated = { ...existing };
        if (status !== undefined) updated.status = status;
        if (tasksTotal !== undefined) updated.tasksTotal = tasksTotal;
        if (tasksCompleted !== undefined) updated.tasksCompleted = tasksCompleted;
        if (notes !== undefined) updated.notes = notes;

        const sha = await github.getFileSha(env, `data/progress/${id}.json`);
        await github.writeFile(
          env,
          `data/progress/${id}.json`,
          JSON.stringify(updated, null, 2),
          `mcp: update ${id}`,
          sha,
        );

        return {
          content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Failed to update milestone: ${String(err)}` }],
        };
      }
    }
  );
}
