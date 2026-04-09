import { createClient } from "../api.js";
import { createOutput } from "../output.js";
import { withErrors, requireProject, normalizePath, formatSize, typeIcon } from "../helpers.js";

function detectNodeType(path) {
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md") || path.endsWith(".markdown")) return "markdown";
  return "file";
}

function contentPath(projectId, action) {
  return `/content/${projectId}/${action}`;
}

export function registerData(program) {
  const data = program
    .command("data")
    .description("Remote file system operations (CRUD on MUT content tree)");

  // ─── ls ────────────────────────────────────────────────

  data
    .command("ls")
    .description("List directory contents")
    .argument("[path]", "directory path (default: project root)")
    .option("-l, --long", "detailed output (size, type, hash)")
    .action(withErrors(async (path, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);
      const cleanPath = normalizePath(path || "");

      const result = await client.get(contentPath(projectId, "ls"), { path: cleanPath });
      const entries = result.entries || [];

      if (out.json) {
        out.success({ entries, path: cleanPath, version: result.version });
        return;
      }

      if (!entries.length) {
        out.info("  (empty directory)");
        return;
      }

      if (opts.long) {
        out.table(
          entries.map(e => ({
            type: e.type,
            name: e.name,
            size: e.type === "folder"
              ? `${e.children_count ?? "?"} items`
              : formatSize(e.size_bytes),
            hash: e.content_hash ? e.content_hash.substring(0, 8) : "-",
          })),
          [
            { key: "type", label: "TYPE" },
            { key: "name", label: "NAME" },
            { key: "size", label: "SIZE" },
            { key: "hash", label: "HASH" },
          ]
        );
      } else {
        for (const e of entries) {
          const icon = typeIcon(e.type);
          const detail = e.type === "folder"
            ? `${e.children_count ?? "?"} items`
            : formatSize(e.size_bytes);
          out.info(`  ${icon} ${e.name.padEnd(30)} ${detail}`);
        }
      }
    }));

  // ─── cat ───────────────────────────────────────────────

  data
    .command("cat")
    .description("Read file contents")
    .argument("<path>", "file path")
    .action(withErrors(async (path, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);
      const cleanPath = normalizePath(path);

      const result = await client.get(contentPath(projectId, "cat"), { path: cleanPath });

      if (out.json) {
        out.success(result);
        return;
      }

      if (result.content != null) {
        out.raw(typeof result.content === "string"
          ? result.content
          : JSON.stringify(result.content, null, 2));
      } else if (result.content_text != null) {
        out.raw(result.content_text);
      }
    }));

  // ─── tree ──────────────────────────────────────────────

  data
    .command("tree")
    .description("Show directory tree")
    .argument("[path]", "starting path (default: project root)")
    .option("-d, --depth <n>", "max depth (-1 = unlimited)", "-1")
    .action(withErrors(async (path, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);
      const cleanPath = normalizePath(path || "");

      const result = await client.get(contentPath(projectId, "tree"), {
        path: cleanPath,
        max_depth: opts.depth,
      });
      const entries = result.entries || [];

      if (out.json) {
        out.success({ entries, path: cleanPath, version: result.version });
        return;
      }

      if (!entries.length) {
        out.info("  (empty)");
        return;
      }

      for (const e of entries) {
        const depth = e.path.split("/").length - (cleanPath ? cleanPath.split("/").length : 0) - 1;
        const indent = "  ".repeat(Math.max(0, depth));
        const icon = typeIcon(e.type);
        out.info(`  ${indent}${icon} ${e.name}`);
      }
    }));

  // ─── stat ──────────────────────────────────────────────

  data
    .command("stat")
    .description("Show file/directory info")
    .argument("<path>", "file or directory path")
    .action(withErrors(async (path, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);
      const cleanPath = normalizePath(path);

      const result = await client.get(contentPath(projectId, "stat"), { path: cleanPath });

      if (!result.exists) {
        out.error("NOT_FOUND", `Path not found: ${cleanPath}`);
        return;
      }

      if (out.json) {
        out.success(result);
        return;
      }

      out.kv([
        ["Path:", result.path],
        ["Name:", result.name],
        ["Type:", result.type],
        ["Size:", formatSize(result.size_bytes)],
        ["MIME:", result.mime_type ?? "-"],
        ["Hash:", result.content_hash ?? "-"],
        ["Children:", result.children_count != null ? String(result.children_count) : "-"],
      ]);
    }));

  // ─── write ─────────────────────────────────────────────

  data
    .command("write")
    .description("Write a file (from --content, --file, or stdin)")
    .argument("<path>", "destination path in the content tree")
    .option("--content <text>", "inline content string")
    .option("--file <local-path>", "read content from a local file")
    .option("--type <type>", "node type: json | markdown | file (auto-detected from extension)")
    .option("-m, --message <msg>", "commit message")
    .action(withErrors(async (path, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);
      const cleanPath = normalizePath(path);

      let content;

      if (opts.content != null) {
        content = opts.content;
      } else if (opts.file) {
        const { readFileSync } = await import("node:fs");
        content = readFileSync(opts.file, "utf-8");
      } else if (!process.stdin.isTTY) {
        const chunks = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        content = Buffer.concat(chunks).toString("utf-8");
      } else {
        out.error("NO_CONTENT", "No content provided.", "Use --content, --file, or pipe via stdin.");
        return;
      }

      const nodeType = opts.type || detectNodeType(cleanPath);

      if (nodeType === "json") {
        try { content = JSON.parse(content); } catch {}
      }

      const result = await client.post(contentPath(projectId, "write"), {
        path: cleanPath,
        content,
        node_type: nodeType,
        message: opts.message || `edit ${cleanPath}`,
      });

      out.info(`Written: ${result.path ?? cleanPath} (v${result.version})`);
      out.success(result);
    }));

  // ─── touch ─────────────────────────────────────────────

  data
    .command("touch")
    .description("Create an empty file")
    .argument("<path>", "file path")
    .option("-m, --message <msg>", "commit message")
    .action(withErrors(async (path, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);
      const cleanPath = normalizePath(path);
      const nodeType = detectNodeType(cleanPath);

      const emptyContent = nodeType === "json" ? {} : "";

      const result = await client.post(contentPath(projectId, "write"), {
        path: cleanPath,
        content: emptyContent,
        node_type: nodeType,
        message: opts.message || `create ${cleanPath}`,
      });

      out.info(`Created: ${result.path ?? cleanPath} (v${result.version})`);
      out.success(result);
    }));

  // ─── mkdir ─────────────────────────────────────────────

  data
    .command("mkdir")
    .description("Create a directory")
    .argument("<path>", "directory path")
    .option("-m, --message <msg>", "commit message")
    .action(withErrors(async (path, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);
      const cleanPath = normalizePath(path);

      const result = await client.post(contentPath(projectId, "mkdir"), {
        path: cleanPath,
      });

      out.info(`Directory created: ${result.path ?? cleanPath} (v${result.version})`);
      out.success(result);
    }));

  // ─── cp ────────────────────────────────────────────────

  data
    .command("cp")
    .description("Copy a file")
    .argument("<src>", "source path")
    .argument("<dst>", "destination path")
    .option("-m, --message <msg>", "commit message")
    .action(withErrors(async (src, dst, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);
      const srcPath = normalizePath(src);
      const dstPath = normalizePath(dst);

      const readResult = await client.get(contentPath(projectId, "cat"), { path: srcPath });

      const content = readResult.content ?? readResult.content_text ?? "";
      const nodeType = detectNodeType(dstPath);

      const result = await client.post(contentPath(projectId, "write"), {
        path: dstPath,
        content,
        node_type: nodeType,
        message: opts.message || `copy ${srcPath} → ${dstPath}`,
      });

      out.info(`Copied: ${srcPath} → ${result.path ?? dstPath} (v${result.version})`);
      out.success(result);
    }));

  // ─── mv ────────────────────────────────────────────────

  data
    .command("mv")
    .description("Move or rename a file/directory")
    .argument("<src>", "source path")
    .argument("<dst>", "destination path")
    .option("-m, --message <msg>", "commit message")
    .action(withErrors(async (src, dst, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);
      const srcPath = normalizePath(src);
      const dstPath = normalizePath(dst);

      const result = await client.post(contentPath(projectId, "mv"), {
        old_path: srcPath,
        new_path: dstPath,
        message: opts.message || `moved ${srcPath} → ${dstPath}`,
      });

      out.info(`Moved: ${srcPath} → ${dstPath} (v${result.version})`);
      out.success(result);
    }));

  // ─── rm ────────────────────────────────────────────────

  data
    .command("rm")
    .description("Delete a file or directory (moves to .trash by default)")
    .argument("<path>", "path to delete")
    .option("-f, --force", "permanently delete (skip trash)")
    .option("-m, --message <msg>", "commit message")
    .action(withErrors(async (path, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);
      const cleanPath = normalizePath(path);

      const result = await client.post(contentPath(projectId, "rm"), {
        path: cleanPath,
        permanent: !!opts.force,
      });

      if (opts.force) {
        out.info(`Deleted permanently: ${cleanPath} (v${result.version})`);
      } else {
        out.info(`Moved to trash: ${cleanPath} → ${result.new_path || ".trash"} (v${result.version})`);
      }
      out.success(result);
    }));

  // ─── trash ─────────────────────────────────────────────

  data
    .command("trash")
    .description("List contents of the trash bin")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const result = await client.get(contentPath(projectId, "trash"));
      const entries = result.entries || [];

      if (out.json) {
        out.success({ entries });
        return;
      }

      if (!entries.length) {
        out.info("  Trash is empty.");
        return;
      }

      for (const e of entries) {
        const icon = typeIcon(e.type);
        out.info(`  ${icon} ${e.path}`);
      }
    }));

  // ─── restore ───────────────────────────────────────────

  data
    .command("restore")
    .description("Restore a file from the trash bin")
    .argument("<trash-path>", "path inside .trash")
    .argument("[original-path]", "restore destination (defaults to original location)")
    .option("-m, --message <msg>", "commit message")
    .action(withErrors(async (trashPath, originalPath, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const cleanTrashPath = normalizePath(trashPath);
      const cleanOriginal = originalPath ? normalizePath(originalPath) : cleanTrashPath.replace(/^\.trash\//, "").replace(/_\d+$/, "");

      const result = await client.post(contentPath(projectId, "restore"), {
        trash_path: cleanTrashPath,
        original_path: cleanOriginal,
      });

      out.info(`Restored: ${cleanTrashPath} → ${result.new_path ?? cleanOriginal} (v${result.version})`);
      out.success(result);
    }));
}
