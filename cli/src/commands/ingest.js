import { readFileSync, statSync } from "node:fs";
import { basename, extname, resolve as pathResolve } from "node:path";
import { createClient } from "../api.js";
import { createOutput } from "../output.js";
import { withErrors, requireProject, normalizePath, formatDate } from "../helpers.js";

const TEXT_EXTS = new Set([
  ".txt", ".md", ".markdown", ".py", ".js", ".ts", ".tsx", ".jsx",
  ".css", ".html", ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg",
  ".sh", ".bash", ".zsh", ".fish", ".sql", ".r", ".rb", ".go",
  ".rs", ".java", ".kt", ".swift", ".c", ".cpp", ".h", ".hpp",
  ".csv", ".tsv", ".log",
]);

const OCR_EXTS = new Set([
  ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".tiff", ".bmp",
  ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx",
]);

export function registerIngest(program) {
  const ing = program
    .command("ingest")
    .description("Data ingestion — import files and URLs into the project");

  // ── file ──────────────────────────────────────────────────
  ing
    .command("file")
    .description("Ingest a local file (with optional OCR/parsing)")
    .argument("<path>", "local file path")
    .option("--folder <remote-path>", "target folder in project")
    .option("--mode <mode>", "processing mode: raw, ocr_parse", "raw")
    .option("--name <name>", "override file name")
    .action(withErrors(async (localPath, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const absPath = pathResolve(localPath);
      statSync(absPath);
      const fileName = opts.name ?? basename(absPath);
      const ext = extname(fileName).toLowerCase();

      const folderPath = opts.folder ? normalizePath(opts.folder) : "";
      const destPath = folderPath ? `${folderPath}/${fileName}` : fileName;

      let mode = opts.mode;
      if (mode === "raw" && OCR_EXTS.has(ext)) {
        out.warn(`${ext} file detected. Consider using --mode ocr_parse for better results.`);
      }

      out.step(`Ingesting ${fileName} (${mode})...`);

      if (ext === ".json" && mode === "raw") {
        const content = readFileSync(absPath, "utf-8");
        const result = await client.post(`/tree/${projectId}/write`, {
          path: destPath,
          content,
          type: "json",
        });
        out.done("done");
        out.info(`  Created: ${destPath}`);
        out.success({ path: destPath, result });
        return;
      }

      if (TEXT_EXTS.has(ext) && mode === "raw") {
        const content = readFileSync(absPath, "utf-8");
        const mdPath = destPath.endsWith(".md") ? destPath : `${destPath}.md`;
        const result = await client.post(`/tree/${projectId}/write`, {
          path: mdPath,
          content,
          type: "markdown",
        });
        out.done("done");
        out.info(`  Created: ${mdPath}`);
        out.success({ path: mdPath, result });
        return;
      }

      const fileContent = readFileSync(absPath);
      const base64 = fileContent.toString("base64");
      const result = await client.post(`/tree/${projectId}/write`, {
        path: destPath,
        content: base64,
        encoding: "base64",
        type: "file",
      });

      if (mode === "ocr_parse" || OCR_EXTS.has(ext)) {
        try {
          const task = await client.post("/ingest/submit/file", {
            project_id: projectId,
            path: destPath,
            mode: "ocr_parse",
          });
          out.done("done");
          out.info(`  File uploaded and ETL task submitted: ${task.task_id ?? task.id ?? "(submitted)"}`);
          out.info(`  Check status: puppyone ingest status ${task.task_id ?? task.id ?? ""}`);
          out.success({ path: destPath, task });
          return;
        } catch {
          // fall through if submit endpoint doesn't work
        }
      }

      out.done("done");
      out.info(`  File uploaded: ${destPath}`);
      out.success({ path: destPath, result });
    }));

  // ── url ───────────────────────────────────────────────────
  ing
    .command("url")
    .description("Ingest content from a URL")
    .argument("<url>", "URL to ingest")
    .option("--folder <remote-path>", "target folder in project")
    .option("--name <name>", "override node name")
    .action(withErrors(async (url, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const folderPath = opts.folder ? normalizePath(opts.folder) : null;

      out.step(`Ingesting ${url}...`);

      const result = await client.post("/ingest/submit/saas", {
        project_id: projectId,
        url,
        name: opts.name,
        folder_path: folderPath,
      });

      out.done("done");
      const taskId = result?.task_id ?? result?.id;
      if (taskId) {
        out.info(`  Task submitted: ${taskId}`);
        out.info(`  Check status: puppyone ingest status ${taskId}`);
      } else {
        out.info("  Ingestion submitted.");
      }
      out.success({ result });
    }));

  // ── status ────────────────────────────────────────────────
  ing
    .command("status")
    .description("Check ingestion task status")
    .argument("<task-id>", "task ID")
    .action(withErrors(async (taskId, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);

      const data = await client.get(`/ingest/tasks/${taskId}`);

      out.kv([
        ["Task ID:", data.task_id ?? data.id ?? taskId],
        ["Status:", data.status ?? data.state ?? "-"],
        ["Progress:", data.progress != null ? `${data.progress}%` : "-"],
        ["Created:", formatDate(data.created_at)],
        ["Updated:", formatDate(data.updated_at)],
        ["Result:", data.result ?? data.message ?? "-"],
      ]);
      out.success({ task: data });
    }));

  // ── tasks ─────────────────────────────────────────────────
  ing
    .command("tasks")
    .description("List recent ingestion tasks")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      try {
        const data = await client.get("/ingest/tasks", { project_id: projectId });
        const tasks = Array.isArray(data) ? data : data?.items ?? [];

        out.table(
          tasks.map((t) => ({
            id: (t.task_id ?? t.id ?? "").slice(0, 8),
            status: t.status ?? t.state ?? "-",
            type: t.type ?? "-",
            name: t.name ?? t.file_name ?? "-",
            updated: formatDate(t.updated_at),
          })),
          [
            { key: "id", label: "ID" },
            { key: "status", label: "STATUS" },
            { key: "type", label: "TYPE" },
            { key: "name", label: "NAME" },
            { key: "updated", label: "UPDATED" },
          ]
        );
        out.success({ tasks });
      } catch {
        out.info("No tasks found or endpoint not available.");
        out.success({ tasks: [] });
      }
    }));

  // ── cancel ────────────────────────────────────────────────
  ing
    .command("cancel")
    .description("Cancel an ingestion task")
    .argument("<task-id>", "task ID to cancel")
    .action(withErrors(async (taskId, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      await client.del(`/ingest/tasks/${taskId}`);
      out.info(`Task cancelled: ${taskId}`);
      out.success({ cancelled: taskId });
    }));
}
