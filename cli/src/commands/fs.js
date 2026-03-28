import { readFileSync, writeFileSync, createWriteStream } from "node:fs";
import { basename, extname, resolve as pathResolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createClient } from "../api.js";
import { createOutput } from "../output.js";
import {
  withErrors, requireProject, normalizePath,
  splitPath, formatDate, formatSize, typeIcon,
} from "../helpers.js";

export function registerFs(program) {
  const fs = program
    .command("fs")
    .description("Cloud file system — browse, read, write, upload, download");

  // ── ls ────────────────────────────────────────────────────
  fs
    .command("ls")
    .description("List files and folders")
    .argument("[path]", "remote path (default: /)", "/")
    .option("-l, --long", "show detailed info")
    .action(withErrors(async (pathArg, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const path = normalizePath(pathArg);
      const data = await client.get(`/content/${projectId}/ls`, { path });
      const entries = data?.entries ?? data?.items ?? (Array.isArray(data) ? data : []);

      if (opts.long) {
        out.table(
          entries.map((n) => ({
            type: n.type,
            name: n.name,
            path: n.path,
            size: formatSize(n.size_bytes),
          })),
          [
            { key: "type", label: "TYPE" },
            { key: "name", label: "NAME" },
            { key: "path", label: "PATH" },
            { key: "size", label: "SIZE" },
          ]
        );
      } else {
        for (const n of entries) {
          out.info(`  ${typeIcon(n.type)} ${n.name}${n.type === "folder" ? "/" : ""}`);
        }
        if (!entries.length) out.info("  (empty)");
      }

      out.success({ path: pathArg, entries });
    }));

  // ── tree ──────────────────────────────────────────────────
  fs
    .command("tree")
    .description("Display file tree")
    .argument("[path]", "remote path (default: /)", "/")
    .option("-d, --depth <n>", "max depth", "3")
    .action(withErrors(async (pathArg, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);
      const maxDepth = parseInt(opts.depth, 10) || 3;

      async function walk(dirPath, prefix, depth) {
        if (depth > maxDepth) return;
        const data = await client.get(`/content/${projectId}/ls`, { path: dirPath });
        const entries = data?.entries ?? data?.items ?? (Array.isArray(data) ? data : []);
        for (let i = 0; i < entries.length; i++) {
          const n = entries[i];
          const isLast = i === entries.length - 1;
          const connector = isLast ? "└── " : "├── ";
          const icon = typeIcon(n.type);
          out.info(`${prefix}${connector}${icon} ${n.name}${n.type === "folder" ? "/" : ""}`);
          if (n.type === "folder") {
            const childPrefix = prefix + (isLast ? "    " : "│   ");
            await walk(n.path, childPrefix, depth + 1);
          }
        }
      }

      out.info(`  ${pathArg ?? "/"}`);
      await walk(normalizePath(pathArg), "  ", 1);
      out.success({ path: pathArg });
    }));

  // ── cat ───────────────────────────────────────────────────
  fs
    .command("cat")
    .description("Read file content")
    .argument("<path>", "remote file path")
    .action(withErrors(async (pathArg, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const path = normalizePath(pathArg);
      const data = await client.get(`/content/${projectId}/cat`, { path });

      if (data.content != null) {
        if (typeof data.content === "string") {
          out.raw(data.content);
        } else {
          out.raw(JSON.stringify(data.content, null, 2));
        }
      } else if (data.content_text != null) {
        out.raw(data.content_text);
      } else if (data.type === "file") {
        out.info(`(binary file — use \`puppyone fs download ${pathArg}\` to download)`);
      }

      out.success({ path, data });
    }));

  // ── mkdir ─────────────────────────────────────────────────
  fs
    .command("mkdir")
    .description("Create a folder")
    .argument("<path>", "folder path to create")
    .action(withErrors(async (pathArg, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const path = normalizePath(pathArg);
      const result = await client.post(`/content/${projectId}/mkdir`, { path });

      out.info(`Created folder: ${pathArg}`);
      out.success({ path, result });
    }));

  // ── touch ─────────────────────────────────────────────────
  fs
    .command("touch")
    .description("Create an empty file (json or markdown)")
    .argument("<path>", "file path")
    .option("-t, --type <type>", "file type: json, markdown", "json")
    .action(withErrors(async (pathArg, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const path = normalizePath(pathArg);
      const ext = extname(path).toLowerCase();

      let fileType = opts.type;
      if (ext === ".md" || ext === ".markdown") fileType = "markdown";
      else if (ext === ".json") fileType = "json";

      const content = fileType === "markdown" ? "" : "{}";

      const result = await client.post(`/content/${projectId}/write`, {
        path,
        content,
        type: fileType,
      });

      out.info(`Created ${fileType}: ${pathArg}`);
      out.success({ path, result });
    }));

  // ── write ─────────────────────────────────────────────────
  fs
    .command("write")
    .description("Write content to a file (reads from stdin or --data)")
    .argument("<path>", "remote file path")
    .option("-d, --data <content>", "content string (or pipe via stdin)")
    .option("-f, --file <local-path>", "read content from local file")
    .action(withErrors(async (pathArg, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      let content;
      if (opts.data) {
        try { content = JSON.parse(opts.data); } catch { content = opts.data; }
      } else if (opts.file) {
        const raw = readFileSync(pathResolve(opts.file), "utf-8");
        try { content = JSON.parse(raw); } catch { content = raw; }
      } else {
        const chunks = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString("utf-8");
        try { content = JSON.parse(raw); } catch { content = raw; }
      }

      const path = normalizePath(pathArg);
      const contentStr = typeof content === "string" ? content : JSON.stringify(content, null, 2);

      const result = await client.post(`/content/${projectId}/write`, {
        path,
        content: contentStr,
      });

      out.info(`Updated: ${pathArg}`);
      out.success({ path, result });
    }));

  // ── mv ────────────────────────────────────────────────────
  fs
    .command("mv")
    .description("Move or rename a file/folder")
    .argument("<src>", "source path")
    .argument("<dst>", "destination path or new name")
    .action(withErrors(async (src, dst, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const srcPath = normalizePath(src);
      const dstPath = normalizePath(dst);

      await client.post(`/content/${projectId}/move`, { src: srcPath, dst: dstPath });

      out.info(`Moved: ${src} → ${dst}`);
      out.success({ from: src, to: dst });
    }));

  // ── rm ────────────────────────────────────────────────────
  fs
    .command("rm")
    .description("Delete a file or folder (soft delete → .trash)")
    .argument("<path>", "remote path")
    .action(withErrors(async (pathArg, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const path = normalizePath(pathArg);
      await client.post(`/content/${projectId}/rm`, { path });

      out.info(`Deleted: ${pathArg}`);
      out.success({ deleted: pathArg });
    }));

  // ── info ──────────────────────────────────────────────────
  fs
    .command("info")
    .description("Show detailed file/folder info")
    .argument("<path>", "remote path")
    .action(withErrors(async (pathArg, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const path = normalizePath(pathArg);
      const data = await client.get(`/content/${projectId}/stat`, { path });

      out.kv([
        ["Name:", data.name],
        ["Path:", data.path],
        ["Type:", data.type],
        ["Size:", formatSize(data.size_bytes)],
        ["MIME:", data.mime_type ?? "-"],
        ["Children:", data.children_count != null ? String(data.children_count) : "-"],
        ["Hash:", data.content_hash ?? "-"],
      ]);

      out.success({ entry: data });
    }));

  // ── upload ────────────────────────────────────────────────
  fs
    .command("upload")
    .description("Upload a local file to the cloud file system")
    .argument("<local-path>", "local file to upload")
    .argument("[remote-path]", "remote destination folder or file path")
    .action(withErrors(async (localPath, remotePath, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const absLocal = pathResolve(localPath);
      const fileName = basename(absLocal);
      const ext = extname(fileName).toLowerCase();
      const fileContent = readFileSync(absLocal);

      const destPath = remotePath
        ? normalizePath(remotePath) + "/" + fileName
        : fileName;

      out.step(`Uploading ${fileName}...`);

      if (ext === ".json" || ext === ".md" || ext === ".markdown" || ext === ".txt") {
        const text = fileContent.toString("utf-8");
        const type = ext === ".json" ? "json" : "markdown";
        await client.post(`/content/${projectId}/write`, {
          path: destPath,
          content: text,
          type,
        });
        out.done("done");
        out.info(`  Uploaded: ${fileName} → ${destPath}`);
      } else {
        const base64 = fileContent.toString("base64");
        await client.post(`/content/${projectId}/write`, {
          path: destPath,
          content: base64,
          encoding: "base64",
          type: "file",
        });
        out.done("done");
        out.info(`  Uploaded: ${fileName} → ${destPath}`);
      }

      out.success({ file: fileName, path: destPath });
    }));

  // ── download ──────────────────────────────────────────────
  fs
    .command("download")
    .description("Download a file from the cloud file system")
    .argument("<remote-path>", "remote file path")
    .argument("[local-path]", "local destination (default: current dir)")
    .action(withErrors(async (remotePath, localPath, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const path = normalizePath(remotePath);
      const data = await client.get(`/content/${projectId}/cat`, { path });

      const fileName = path.includes("/") ? path.split("/").pop() : path;
      const destFile = localPath ? pathResolve(localPath) : pathResolve(fileName);

      if (data.content != null) {
        const text = typeof data.content === "string"
          ? data.content
          : JSON.stringify(data.content, null, 2);
        writeFileSync(destFile, text, "utf-8");
      } else if (data.content_text != null) {
        writeFileSync(destFile, data.content_text, "utf-8");
      } else if (data.download_url) {
        out.step(`Downloading ${fileName}...`);
        const res = await fetch(data.download_url);
        if (!res.ok) {
          out.done("");
          out.error("DOWNLOAD_FAILED", `Download failed: ${res.status}`);
          return;
        }
        const ws = createWriteStream(destFile);
        await pipeline(res.body, ws);
        out.done("done");
      } else {
        out.error("NO_CONTENT", "File has no downloadable content.");
        return;
      }

      out.info(`Downloaded: ${remotePath} → ${destFile}`);
      out.success({ path: destFile });
    }));

  // ── versions ──────────────────────────────────────────────
  fs
    .command("versions")
    .description("Show version history")
    .argument("[path]", "file path (omit for project-level history)")
    .action(withErrors(async (pathArg, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const params = { limit: "50" };
      if (pathArg) params.path = normalizePath(pathArg);

      const data = await client.get(`/content/${projectId}/versions`, params);
      const commits = data?.commits ?? [];

      for (const c of commits) {
        const isHead = c.version === data.current_version;
        const tag = isHead ? " ● HEAD" : "";
        const changes = (c.changes || []);
        const added = changes.filter(x => x.op === "added").length;
        const modified = changes.filter(x => x.op === "modified").length;
        const deleted = changes.filter(x => x.op === "deleted").length;
        const stats = [
          added ? `+${added}` : "",
          modified ? `~${modified}` : "",
          deleted ? `-${deleted}` : "",
        ].filter(Boolean).join(" ");

        out.info(`  v${c.version}${tag}  ${c.who}  "${c.message}"  ${stats}  ${formatDate(c.created_at)}`);
      }

      if (!commits.length) out.info("  No commits yet.");
      out.success({ current_version: data.current_version, commits });
    }));

  // ── diff ──────────────────────────────────────────────────
  fs
    .command("diff")
    .description("Compare two versions")
    .argument("<v1>", "first version number")
    .argument("<v2>", "second version number")
    .option("--path <path>", "file path to diff")
    .action(withErrors(async (v1, v2, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const params = { v1, v2 };
      if (opts.path) params.path = normalizePath(opts.path);

      const data = await client.get(`/content/${projectId}/diff`, params);
      if (data?.changes) {
        for (const c of data.changes) {
          const color = c.change_type === "added" ? "+" : c.change_type === "removed" ? "-" : "~";
          out.info(`  ${color} ${c.path}`);
        }
      } else {
        out.raw(JSON.stringify(data, null, 2));
      }
      out.success({ diff: data });
    }));

  // ── rollback ──────────────────────────────────────────────
  fs
    .command("rollback")
    .description("Rollback to a previous version")
    .argument("<version>", "version number to rollback to")
    .option("--path <path>", "file path to rollback")
    .action(withErrors(async (version, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const body = { target_version: parseInt(version, 10) };
      if (opts.path) body.path = normalizePath(opts.path);

      const result = await client.post(`/content/${projectId}/rollback`, body);
      out.info(`Rolled back to version ${version}`);
      out.success({ result });
    }));

  // ── audit ─────────────────────────────────────────────────
  fs
    .command("audit")
    .description("Show audit log for a file or folder")
    .argument("<path>", "remote path")
    .action(withErrors(async (pathArg, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const path = normalizePath(pathArg);
      const data = await client.get(`/nodes/${encodeURIComponent(path)}/audit-logs`, { project_id: projectId });
      const logs = data?.logs ?? (Array.isArray(data) ? data : data?.items ?? []);

      out.table(
        logs.map((l) => ({
          time: formatDate(l.created_at ?? l.timestamp),
          action: l.action ?? l.event_type ?? "-",
          who: l.operator_id ?? l.user_email ?? l.actor ?? "-",
          detail: l.detail ?? l.description ?? "-",
        })),
        [
          { key: "time", label: "TIME" },
          { key: "action", label: "ACTION" },
          { key: "who", label: "WHO" },
          { key: "detail", label: "DETAIL" },
        ]
      );
      out.success({ path, audit_logs: logs });
    }));
}
