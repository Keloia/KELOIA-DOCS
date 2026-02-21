// Write tools: keloia_add_task, keloia_move_task, keloia_update_progress
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { KANBAN_DIR, PROGRESS_DIR } from "../paths.js";

// ── Module-level helpers ─────────────────────────────────────────────────────

const VALID_COLUMNS = ["Backlog", "In Progress", "Done"] as const;
const VALID_STATUSES = ["pending", "in-progress", "done"] as const;

/** Writes data to a temp file then atomically renames it to targetPath. */
function atomicWriteJson(targetPath: string, data: unknown): void {
  const tmp = `${targetPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, targetPath);
}

/**
 * Given existing task IDs (e.g. ["task-001", "task-003"]), returns the next
 * sequential ID padded to three digits. Returns "task-001" for an empty array.
 */
function nextTaskId(existingIds: string[]): string {
  if (existingIds.length === 0) return "task-001";
  const nums = existingIds.map((id) => {
    const match = id.match(/(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
  });
  const max = Math.max(...nums);
  return "task-" + String(max + 1).padStart(3, "0");
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerWriteTools(server: McpServer): void {

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
        const index = JSON.parse(
          readFileSync(join(KANBAN_DIR, "index.json"), "utf-8")
        ) as { schemaVersion: number; columns: string[]; tasks: string[] };

        const id = nextTaskId(index.tasks);
        const task = {
          id,
          title,
          column,
          description: description ?? null,
          assignee: assignee ?? null,
        };

        // Write task file first, then update index
        atomicWriteJson(join(KANBAN_DIR, `${id}.json`), task);
        atomicWriteJson(join(KANBAN_DIR, "index.json"), {
          ...index,
          tasks: [...index.tasks, id],
        });

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
        "Moves an existing keloia kanban task to a different column. Updates the task file atomically. Returns the updated task object.",
      inputSchema: {
        id: z.string().describe("Task ID (e.g. 'task-001')"),
        column: z.enum(VALID_COLUMNS).describe("Target column"),
      },
    },
    async ({ id, column }) => {
      try {
        const index = JSON.parse(
          readFileSync(join(KANBAN_DIR, "index.json"), "utf-8")
        ) as { columns: string[]; tasks: string[] };

        if (!index.tasks.includes(id)) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Task not found: "${id}". Known tasks: ${index.tasks.join(", ")}`,
              },
            ],
          };
        }

        const existing = JSON.parse(
          readFileSync(join(KANBAN_DIR, `${id}.json`), "utf-8")
        ) as Record<string, unknown>;

        const updated = { ...existing, column };
        atomicWriteJson(join(KANBAN_DIR, `${id}.json`), updated);

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
        "Updates fields on a keloia milestone. Merges only the provided fields into the existing milestone file atomically. Returns the updated milestone object.",
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
        const index = JSON.parse(
          readFileSync(join(PROGRESS_DIR, "index.json"), "utf-8")
        ) as { milestones: string[] };

        if (!index.milestones.includes(id)) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Milestone not found: "${id}". Known: ${index.milestones.join(", ")}`,
              },
            ],
          };
        }

        const existing = JSON.parse(
          readFileSync(join(PROGRESS_DIR, `${id}.json`), "utf-8")
        ) as Record<string, unknown>;

        const updated = { ...existing };
        if (status !== undefined) updated.status = status;
        if (tasksTotal !== undefined) updated.tasksTotal = tasksTotal;
        if (tasksCompleted !== undefined) updated.tasksCompleted = tasksCompleted;
        if (notes !== undefined) updated.notes = notes;

        atomicWriteJson(join(PROGRESS_DIR, `${id}.json`), updated);

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
