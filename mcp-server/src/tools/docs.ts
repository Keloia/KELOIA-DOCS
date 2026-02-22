// Doc tools: keloia_search_docs, keloia_add_doc, keloia_edit_doc, keloia_delete_doc
import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DOCS_DIR } from "../paths.js";

// ── Module-level helpers ─────────────────────────────────────────────────────

/** Slug format: lowercase alphanumeric with internal hyphens. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

/** Writes text content to a temp file then atomically renames it to targetPath. */
function atomicWriteText(targetPath: string, text: string): void {
  const tmp = `${targetPath}.tmp`;
  writeFileSync(tmp, text, "utf-8");
  renameSync(tmp, targetPath);
}

/** Writes JSON data to a temp file then atomically renames it to targetPath. */
function atomicWriteJson(targetPath: string, data: unknown): void {
  const tmp = `${targetPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, targetPath);
}

// ── Index type ────────────────────────────────────────────────────────────────

interface DocsIndex {
  schemaVersion: number;
  docs: Array<{ slug: string; title: string }>;
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerDocTools(server: McpServer): void {

  // SRCH-05, SRCH-06: Search docs by keyword or regex with optional slug filter
  server.registerTool(
    "keloia_search_docs",
    {
      description:
        "Searches keloia documentation files by keyword or regex pattern. Returns matching lines with slug, title, line number, and a text snippet. Use the optional slug parameter to narrow results to a single doc.",
      inputSchema: {
        pattern: z.string().min(1).describe("Keyword or regex pattern to search for"),
        slug: z.string().optional().describe("Optional: narrow search to a single doc slug"),
        is_regex: z.boolean().optional().default(false).describe("Treat pattern as a regex (default: false = keyword search)"),
      },
    },
    async ({ pattern, slug, is_regex }) => {
      try {
        const indexPath = join(DOCS_DIR, "index.json");
        const index = JSON.parse(readFileSync(indexPath, "utf-8")) as DocsIndex;

        // Filter by slug if provided
        let docsToSearch = index.docs;
        if (slug !== undefined) {
          const found = index.docs.find((d) => d.slug === slug);
          if (!found) {
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: `Document not found: no doc with slug "${slug}". Available slugs: ${index.docs.map((d) => d.slug).join(", ")}`,
                },
              ],
            };
          }
          docsToSearch = [found];
        }

        // Compile regex if is_regex mode
        let compiled: RegExp | null = null;
        if (is_regex) {
          try {
            compiled = new RegExp(pattern, "i");
          } catch {
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: `Invalid regex pattern: "${pattern}"`,
                },
              ],
            };
          }
        }

        const results: Array<{ slug: string; title: string; lineNumber: number; snippet: string }> = [];
        const MAX_RESULTS = 50;

        for (const doc of docsToSearch) {
          if (results.length >= MAX_RESULTS) break;

          const filePath = join(DOCS_DIR, `${doc.slug}.md`);
          if (!existsSync(filePath)) continue;

          const fileContent = readFileSync(filePath, "utf-8");
          const lines = fileContent.split("\n");

          for (let i = 0; i < lines.length; i++) {
            if (results.length >= MAX_RESULTS) break;

            const line = lines[i];
            let matchIndex = -1;

            if (compiled !== null) {
              // Regex mode — reset lastIndex before every exec() to prevent match skipping
              compiled.lastIndex = 0;
              const m = compiled.exec(line);
              if (m) matchIndex = m.index;
            } else {
              // Keyword mode — case-insensitive indexOf
              matchIndex = line.toLowerCase().indexOf(pattern.toLowerCase());
            }

            if (matchIndex !== -1) {
              // Extract 150-char snippet centered on match
              const snippetStart = Math.max(0, matchIndex - 75);
              const snippetEnd = Math.min(line.length, matchIndex + 75);
              const snippet = line.slice(snippetStart, snippetEnd);

              results.push({
                slug: doc.slug,
                title: doc.title,
                lineNumber: i + 1,
                snippet,
              });
            }
          }
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Failed to search docs: ${String(err)}` }],
        };
      }
    }
  );

  // CRUD-06: Create a new documentation file and register in index
  server.registerTool(
    "keloia_add_doc",
    {
      description:
        "Creates a new markdown documentation file in data/docs/ and registers it in the doc index. Fails if the slug already exists. Do NOT use this to update an existing doc — use keloia_edit_doc instead.",
      inputSchema: {
        slug: z.string().min(1).describe("URL-safe slug (lowercase alphanumeric and hyphens, e.g. 'my-new-doc')"),
        title: z.string().min(1).describe("Document title"),
        content: z.string().min(1).describe("Markdown content for the new document"),
      },
    },
    async ({ slug, title, content }) => {
      try {
        // Validate slug format
        if (!SLUG_RE.test(slug)) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Invalid slug format: "${slug}". Slugs must be lowercase alphanumeric with internal hyphens only (e.g. "my-doc").`,
              },
            ],
          };
        }

        const indexPath = join(DOCS_DIR, "index.json");
        const index = JSON.parse(readFileSync(indexPath, "utf-8")) as DocsIndex;

        // Check slug not already in index
        if (index.docs.some((d) => d.slug === slug)) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Slug already exists in index: "${slug}". Use keloia_edit_doc to update an existing doc.`,
              },
            ],
          };
        }

        // Check slug not already on disk (collision guard)
        const filePath = join(DOCS_DIR, `${slug}.md`);
        if (existsSync(filePath)) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `File already exists on disk for slug "${slug}" but is not in the index. Cannot overwrite an unindexed file.`,
              },
            ],
          };
        }

        // Write file then update index
        atomicWriteText(filePath, content);
        atomicWriteJson(indexPath, {
          ...index,
          docs: [...index.docs, { slug, title }],
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ slug, title, created: true }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Failed to add doc: ${String(err)}` }],
        };
      }
    }
  );

  // CRUD-07: Overwrite an existing documentation file, optionally updating its title
  server.registerTool(
    "keloia_edit_doc",
    {
      description:
        "Overwrites an existing keloia documentation file. Optionally updates the document title in the index. Fails if the slug does not exist. Do NOT use this to create a new doc — use keloia_add_doc instead.",
      inputSchema: {
        slug: z.string().min(1).describe("Slug of the document to edit"),
        content: z.string().min(1).describe("New markdown content (replaces existing content entirely)"),
        title: z.string().optional().describe("Optional: new title for the document (updates index entry)"),
      },
    },
    async ({ slug, content, title }) => {
      try {
        const indexPath = join(DOCS_DIR, "index.json");
        const index = JSON.parse(readFileSync(indexPath, "utf-8")) as DocsIndex;

        // Check slug exists in index
        const docEntry = index.docs.find((d) => d.slug === slug);
        if (!docEntry) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Document not found: no doc with slug "${slug}". Use keloia_add_doc to create a new doc. Available slugs: ${index.docs.map((d) => d.slug).join(", ")}`,
              },
            ],
          };
        }

        // Overwrite file content
        const filePath = join(DOCS_DIR, `${slug}.md`);
        atomicWriteText(filePath, content);

        // Optionally update title in index
        if (title !== undefined) {
          const updatedDocs = index.docs.map((d) =>
            d.slug === slug ? { ...d, title } : d
          );
          atomicWriteJson(indexPath, { ...index, docs: updatedDocs });
        }

        const finalTitle = title ?? docEntry.title;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ slug, title: finalTitle, updated: true }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Failed to edit doc: ${String(err)}` }],
        };
      }
    }
  );

  // CRUD-08: Remove a documentation file and deregister from index
  server.registerTool(
    "keloia_delete_doc",
    {
      description:
        "Removes an existing keloia documentation file and deregisters it from the doc index. Fails if the slug does not exist. This operation is irreversible.",
      inputSchema: {
        slug: z.string().min(1).describe("Slug of the document to delete"),
      },
    },
    async ({ slug }) => {
      try {
        const indexPath = join(DOCS_DIR, "index.json");
        const index = JSON.parse(readFileSync(indexPath, "utf-8")) as DocsIndex;

        // Check slug exists in index
        if (!index.docs.some((d) => d.slug === slug)) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Document not found: no doc with slug "${slug}". Available slugs: ${index.docs.map((d) => d.slug).join(", ")}`,
              },
            ],
          };
        }

        // Update index FIRST (before deleting file) — per success criterion #5
        const updatedDocs = index.docs.filter((d) => d.slug !== slug);
        atomicWriteJson(indexPath, { ...index, docs: updatedDocs });

        // Then delete the file
        const filePath = join(DOCS_DIR, `${slug}.md`);
        if (existsSync(filePath)) {
          unlinkSync(filePath);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ slug, deleted: true }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Failed to delete doc: ${String(err)}` }],
        };
      }
    }
  );
}
