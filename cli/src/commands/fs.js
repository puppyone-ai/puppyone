import { readFileSync, writeFileSync, createWriteStream } from "node:fs";
import { basename, extname, resolve as pathResolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createClient } from "../api.js";
import { createOutput } from "../output.js";
import {
  withErrors, requireProject, resolvePath, resolveNode,
  splitPath, formatDate, formatSize, typeIcon,
} from "../helpers.js";

async function listChildren(client, projectId, parentId) {
  const query = { project_id: projectId };
  if (parentId) query.parent_id = parentId;
  const data = await client.get("/nodes", query);
  return Array.isArray(data) ? data : data?.items ?? [];
}

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

      const parentId = await resolvePath(client, projectId, pathArg);
      const children = await listChildren(client, projectId, parentId);

      if (opts.long) {
        out.table(
          children.map((n) => ({
            type: n.type,
            name: n.name,
            id: n.id?.slice(0, 8),
            size: formatSize(n.size),
            updated: formatDate(n.updated_at),
          })),
          [
            { key: "type", label: "TYPE" },
            { key: "name", label: "NAME" },
            { key: "id", label: "ID" },
            { key: "size", label: "SIZE" },
            { key: "updated", label: "UPDATED" },
          ]
        );
      } else {
        for (const n of children) {
          out.info(`  ${typeIcon(n.type)} ${n.name}${n.type === "folder" ? "/" : ""}`);
        }
        if (!children.length) out.info("  (empty)");
      }

      out.success({ path: pathArg, nodes: children });
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

      const parentId = await resolvePath(client, projectId, pathArg);

      async function walk(pid, prefix, depth) {
        if (depth > maxDepth) return;
        const children = await listChildren(client, projectId, pid);
        for (let i = 0; i < children.length; i++) {
          const n = children[i];
          const isLast = i === children.length - 1;
          const connector = isLast ? "└── " : "├── ";
          const icon = typeIcon(n.type);
          out.info(`${prefix}${connector}${icon} ${n.name}${n.type === "folder" ? "/" : ""}`);
          if (n.type === "folder") {
            const childPrefix = prefix + (isLast ? "    " : "│   ");
            await walk(n.id, childPrefix, depth + 1);
          }
        }
      }

      out.info(`  ${pathArg ?? "/"}`);
      await walk(parentId, "  ", 1);
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

      const node = await resolveNode(client, projectId, pathArg);
      if (!node) {
        out.error("NOT_FOUND", `File not found: ${pathArg}`);
        return;
      }

      if (node.type === "folder") {
        out.error("IS_FOLDER", `${pathArg} is a folder. Use \`fs ls\` instead.`);
        return;
      }

      const detail = await client.get(`/nodes/${node.id}`);

      if (detail.content != null) {
        if (typeof detail.content === "string") {
          out.raw(detail.content);
        } else {
          out.raw(JSON.stringify(detail.content, null, 2));
        }
      } else if (detail.type === "file") {
        out.info(`(binary file — use \`puppyone fs download ${pathArg}\` to download)`);
      }

      out.success({ node: detail });
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

      const { parentPath, name } = splitPath(pathArg);
      const parentId = parentPath ? await resolvePath(client, projectId, parentPath) : null;

      const created = await client.post("/nodes/folder", {
        project_id: projectId,
        name,
        parent_id: parentId,
      });

      out.info(`Created folder: ${pathArg} (${created.id})`);
      out.success({ node: created });
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

      const { parentPath, name } = splitPath(pathArg);
      const parentId = parentPath ? await resolvePath(client, projectId, parentPath) : null;

      const ext = extname(name).toLowerCase();
      let fileType = opts.type;
      if (ext === ".md" || ext === ".markdown") fileType = "markdown";
      else if (ext === ".json") fileType = "json";

      const endpoint = fileType === "markdown" ? "/nodes/markdown" : "/nodes/json";
      const content = fileType === "markdown" ? "" : {};

      const created = await client.post(endpoint, {
        project_id: projectId,
        name,
        parent_id: parentId,
        content,
      });

      out.info(`Created ${fileType}: ${pathArg} (${created.id})`);
      out.success({ node: created });
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

      const node = await resolveNode(client, projectId, pathArg);
      if (!node) {
        out.error("NOT_FOUND", `File not found: ${pathArg}`, "Create it first with `puppyone fs touch`.");
        return;
      }

      await client.put(`/nodes/${node.id}`, { content });
      out.info(`Updated: ${pathArg}`);
      out.success({ path: pathArg, node_id: node.id });
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

      const srcNode = await resolveNode(client, projectId, src);
      if (!srcNode) {
        out.error("NOT_FOUND", `Source not found: ${src}`);
        return;
      }

      let dstNode = null;
      try { dstNode = await resolveNode(client, projectId, dst); } catch { /* not found is ok */ }

      if (dstNode && dstNode.type === "folder") {
        await client.post(`/nodes/${srcNode.id}/move`, { parent_id: dstNode.id });
      } else {
        const { parentPath: dstParent, name: dstName } = splitPath(dst);

        if (dstParent) {
          const newParentId = await resolvePath(client, projectId, dstParent);
          await client.post(`/nodes/${srcNode.id}/move`, { parent_id: newParentId });
        }

        if (dstName && dstName !== srcNode.name) {
          await client.put(`/nodes/${srcNode.id}`, { name: dstName });
        }
      }

      out.info(`Moved: ${src} → ${dst}`);
      out.success({ from: src, to: dst });
    }));

  // ── rm ────────────────────────────────────────────────────
  fs
    .command("rm")
    .description("Delete a file or folder (soft delete)")
    .argument("<path>", "remote path")
    .action(withErrors(async (pathArg, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const node = await resolveNode(client, projectId, pathArg);
      if (!node) {
        out.error("NOT_FOUND", `Not found: ${pathArg}`);
        return;
      }

      await client.del(`/nodes/${node.id}`);
      out.info(`Deleted: ${pathArg}`);
      out.success({ deleted: pathArg, node_id: node.id });
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

      const node = await resolveNode(client, projectId, pathArg);
      if (!node) {
        out.error("NOT_FOUND", `Not found: ${pathArg}`);
        return;
      }

      const detail = await client.get(`/nodes/${node.id}`);

      out.kv([
        ["Name:", detail.name],
        ["ID:", detail.id],
        ["Type:", detail.type],
        ["Version:", String(detail.version ?? 1)],
        ["Size:", formatSize(detail.size)],
        ["Created:", formatDate(detail.created_at)],
        ["Updated:", formatDate(detail.updated_at)],
        ["Parent:", detail.parent_id ?? "(root)"],
      ]);

      out.success({ node: detail });
    }));

  // ── upload ────────────────────────────────────────────────
  fs
    .command("upload")
    .description("Upload a local file to the cloud file system")
    .argument("<local-path>", "local file to upload")
    .argument("[remote-path]", "remote destination folder path")
    .action(withErrors(async (localPath, remotePath, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const absLocal = pathResolve(localPath);
      const fileName = basename(absLocal);

      let parentId = null;
      if (remotePath) {
        parentId = await resolvePath(client, projectId, remotePath);
      }

      out.step(`Uploading ${fileName}...`);

      const prepData = await client.post("/nodes/upload", {
        project_id: projectId,
        name: fileName,
        parent_id: parentId,
      });

      if (prepData.upload_url) {
        const fileContent = readFileSync(absLocal);
        const uploadRes = await fetch(prepData.upload_url, {
          method: "PUT",
          body: fileContent,
          headers: { "Content-Type": "application/octet-stream" },
        });
        if (!uploadRes.ok) {
          out.done("");
          out.error("UPLOAD_FAILED", `S3 upload failed: ${uploadRes.status}`);
          return;
        }
      }

      out.done("done");
      out.info(`  Uploaded: ${fileName} → ${remotePath ?? "/"}`);
      out.success({ file: fileName, node: prepData });
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

      const node = await resolveNode(client, projectId, remotePath);
      if (!node) {
        out.error("NOT_FOUND", `Not found: ${remotePath}`);
        return;
      }

      if (node.type === "folder") {
        out.error("IS_FOLDER", "Cannot download a folder.");
        return;
      }

      if (node.type === "json" || node.type === "markdown") {
        const detail = await client.get(`/nodes/${node.id}`);
        const destFile = localPath
          ? pathResolve(localPath)
          : pathResolve(node.name);

        const text = typeof detail.content === "string"
          ? detail.content
          : JSON.stringify(detail.content, null, 2);
        writeFileSync(destFile, text, "utf-8");
        out.info(`Downloaded: ${remotePath} → ${destFile}`);
        out.success({ path: destFile });
        return;
      }

      const dlData = await client.get(`/nodes/${node.id}/download`);
      if (!dlData?.download_url) {
        out.error("NO_URL", "No download URL available.");
        return;
      }

      const destFile = localPath
        ? pathResolve(localPath)
        : pathResolve(node.name);

      out.step(`Downloading ${node.name}...`);

      const res = await fetch(dlData.download_url);
      if (!res.ok) {
        out.done("");
        out.error("DOWNLOAD_FAILED", `Download failed: ${res.status}`);
        return;
      }

      const ws = createWriteStream(destFile);
      await pipeline(res.body, ws);

      out.done("done");
      out.info(`  Downloaded: ${remotePath} → ${destFile}`);
      out.success({ path: destFile });
    }));

  // ── versions ──────────────────────────────────────────────
  fs
    .command("versions")
    .description("Show version history of a file")
    .argument("<path>", "remote file path")
    .action(withErrors(async (pathArg, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const node = await resolveNode(client, projectId, pathArg);
      if (!node) { out.error("NOT_FOUND", `Not found: ${pathArg}`); return; }

      const data = await client.get(`/nodes/${node.id}/versions`);
      const versions = Array.isArray(data) ? data : data?.items ?? [];

      out.table(
        versions.map((v) => ({
          version: String(v.version ?? v.id),
          date: formatDate(v.created_at),
          author: v.author ?? v.user_email ?? "-",
          size: formatSize(v.size),
        })),
        [
          { key: "version", label: "VERSION" },
          { key: "date", label: "DATE" },
          { key: "author", label: "AUTHOR" },
          { key: "size", label: "SIZE" },
        ]
      );
      out.success({ node_id: node.id, versions });
    }));

  // ── diff ──────────────────────────────────────────────────
  fs
    .command("diff")
    .description("Compare two versions of a file")
    .argument("<path>", "remote file path")
    .argument("<v1>", "first version number")
    .argument("<v2>", "second version number")
    .action(withErrors(async (pathArg, v1, v2, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const node = await resolveNode(client, projectId, pathArg);
      if (!node) { out.error("NOT_FOUND", `Not found: ${pathArg}`); return; }

      const data = await client.get(`/nodes/${node.id}/diff/${v1}/${v2}`);
      if (data?.diff) {
        out.raw(typeof data.diff === "string" ? data.diff : JSON.stringify(data.diff, null, 2));
      } else {
        out.raw(JSON.stringify(data, null, 2));
      }
      out.success({ node_id: node.id, v1, v2, diff: data });
    }));

  // ── rollback ──────────────────────────────────────────────
  fs
    .command("rollback")
    .description("Rollback a file to a previous version")
    .argument("<path>", "remote file path")
    .argument("<version>", "version number to rollback to")
    .action(withErrors(async (pathArg, version, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const node = await resolveNode(client, projectId, pathArg);
      if (!node) { out.error("NOT_FOUND", `Not found: ${pathArg}`); return; }

      await client.post(`/nodes/${node.id}/rollback/${version}`);
      out.info(`Rolled back ${pathArg} to version ${version}`);
      out.success({ node_id: node.id, version });
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

      const node = await resolveNode(client, projectId, pathArg);
      if (!node) { out.error("NOT_FOUND", `Not found: ${pathArg}`); return; }

      const data = await client.get(`/nodes/${node.id}/audit-logs`);
      const logs = Array.isArray(data) ? data : data?.items ?? [];

      out.table(
        logs.map((l) => ({
          time: formatDate(l.created_at ?? l.timestamp),
          action: l.action ?? l.event_type ?? "-",
          user: l.user_email ?? l.actor ?? "-",
          detail: l.detail ?? l.description ?? "-",
        })),
        [
          { key: "time", label: "TIME" },
          { key: "action", label: "ACTION" },
          { key: "user", label: "USER" },
          { key: "detail", label: "DETAIL" },
        ]
      );
      out.success({ node_id: node.id, audit_logs: logs });
    }));
}
