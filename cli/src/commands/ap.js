import { ApiError, createAccessKeyClient, collectOpts } from "../api.js";
import {
  deleteAccessPointCredential,
  getAccessPointCredential,
  loadConfig,
  saveAccessPointCredential,
  saveConfig,
  LOCAL_API_URL,
} from "../config.js";
import { createOutput } from "../output.js";
import { withErrors, normalizePath, formatSize, typeIcon } from "../helpers.js";

function detectNodeType(path) {
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md") || path.endsWith(".markdown")) return "markdown";
  return "file";
}

function validateProfileName(profile) {
  if (!/^[A-Za-z0-9._-]+$/.test(profile)) {
    throw new ApiError(
      0,
      "INVALID_PROFILE",
      `Invalid access point profile: ${profile}`,
      "Use letters, numbers, dots, underscores, or dashes.",
    );
  }
}

function resolveAccessPointContext(cmd) {
  const opts = collectOpts(cmd);
  const config = loadConfig();
  const profiles = config.access_points || {};
  const profile = opts.profile || config.current_access_point || null;
  const profileMeta = profile ? profiles[profile] : null;
  const legacy = config.active_access_point || null;
  const key = (
    opts.accessKey ||
    process.env.PUPPYONE_ACCESS_KEY ||
    process.env.PUPPYONE_AP_KEY ||
    (profile ? getAccessPointCredential(profile) : null) ||
    legacy?.access_key
  );
  const apiUrl = opts.apiUrl || profileMeta?.api_url || legacy?.api_url || config.api_url || LOCAL_API_URL;
  if (!key) {
    throw new ApiError(
      0,
      "MISSING_ACCESS_KEY",
      "No active Access Point is configured.",
      "Run `puppyone ap login <profile> --api-url <url>` once, or pass --access-key.",
    );
  }
  return { accessKey: key, apiUrl, profile, profileMeta, legacy };
}

function createApClient(cmd) {
  const { accessKey, apiUrl } = resolveAccessPointContext(cmd);
  return createAccessKeyClient(accessKey, cmd, apiUrl);
}

function scopedPath(path) {
  return normalizePath(path || "");
}

function shortCommit(cid) {
  return cid ? `@${String(cid).slice(0, 8)}` : "";
}

export function registerAp(program) {
  const ap = program
    .command("ap")
    .description("Manage the active Access Point for scoped filesystem operations")
    .option("--access-key <key>", "Access Point key (or PUPPYONE_ACCESS_KEY)")
    .option("-u, --api-url <url>", "PuppyOne API URL for this access point")
    .option("--profile <name>", "Access Point profile override")
    .option("--mut-user <user>", "Acting user identity for user-bound access keys");

  registerAccessPointManagement(ap);
  registerFsCommands(ap);
}

export function registerFs(program) {
  const fs = program
    .command("fs")
    .description("Filesystem operations against the active Access Point")
    .option("--access-key <key>", "Access Point key override")
    .option("-u, --api-url <url>", "PuppyOne API URL override")
    .option("--profile <name>", "Access Point profile override")
    .option("--mut-user <user>", "Acting user identity for user-bound access keys");

  registerFsCommands(fs);
}

function registerAccessPointManagement(ap) {
  ap
    .command("login")
    .description("Save an Access Point profile for future `puppyone fs` commands")
    .argument("<profile>", "local profile name")
    .option("-u, --api-url <url>", "PuppyOne API URL", LOCAL_API_URL)
    .option("--access-key <key>", "Access key (discouraged; prefer prompt or --access-key-stdin)")
    .option("--access-key-stdin", "read the access key from stdin")
    .option("--name <name>", "local label for this access point")
    .action(withErrors(async (profile, opts, cmd) => {
      validateProfileName(profile);
      const out = createOutput(cmd);
      const accessKey = await readAccessKey(opts);
      const client = createAccessKeyClient(accessKey, cmd, opts.apiUrl);
      const result = await _get(client, "/ap-fs/stat", { path: "" });
      const config = loadConfig();
      const profiles = config.access_points || {};
      const metadata = {
        api_url: client.baseUrl,
        name: opts.name || result.scope?.path || "Access Point",
        scope: result.scope || null,
        bound_at: new Date().toISOString(),
      };
      saveAccessPointCredential(profile, accessKey);
      saveConfig({
        access_points: { ...profiles, [profile]: metadata },
        current_access_point: profile,
        active_access_point: null,
      });

      if (out.json) {
        out.success({ profile, access_point: metadata, stat: result });
        return;
      }
      out.info(`Saved Access Point profile: ${profile}`);
      out.info(`Scope: ${metadata.scope?.path || "."} (${metadata.scope?.mode || "r"})`);
      out.info("");
      out.info("Now use:");
      out.info("  puppyone fs ls");
      out.info("  puppyone fs cat <path>");
      out.info("  echo \"hello\" | puppyone fs write <path>");
    }));

  ap
    .command("use")
    .description("Switch the active Access Point profile")
    .argument("<profile>", "local profile name")
    .action(withErrors(async (profile, opts, cmd) => {
      validateProfileName(profile);
      const out = createOutput(cmd);
      const config = loadConfig();
      const metadata = config.access_points?.[profile];
      if (!metadata) {
        out.error("PROFILE_NOT_FOUND", `Access Point profile not found: ${profile}`, "Run `puppyone ap list` or `puppyone ap login <profile>`.");
        return;
      }
      if (!getAccessPointCredential(profile)) {
        out.error("MISSING_CREDENTIAL", `No local credential stored for profile: ${profile}`, `Run \`puppyone ap login ${profile}\` again.`);
        return;
      }
      saveConfig({ current_access_point: profile, active_access_point: null });
      if (out.json) {
        out.success({ current_access_point: profile, access_point: metadata });
        return;
      }
      out.info(`Active Access Point: ${profile}`);
      out.info(`Scope: ${metadata.scope?.path || "."} (${metadata.scope?.mode || "r"})`);
    }));

  ap
    .command("list")
    .description("List saved Access Point profiles")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const config = loadConfig();
      const current = config.current_access_point || null;
      const rows = Object.entries(config.access_points || {}).map(([profile, metadata]) => ({
        profile,
        active: profile === current ? "*" : "",
        name: metadata.name || "-",
        scope: metadata.scope?.path || ".",
        mode: metadata.scope?.mode || "-",
        api_url: metadata.api_url || "-",
        has_key: getAccessPointCredential(profile) ? "yes" : "no",
      }));
      if (out.json) {
        out.success({ current_access_point: current, access_points: rows });
        return;
      }
      if (!rows.length) {
        out.info("No Access Point profiles saved. Run `puppyone ap login <profile>`.");
        return;
      }
      out.table(rows, [
        { key: "active", label: "" },
        { key: "profile", label: "PROFILE" },
        { key: "scope", label: "SCOPE" },
        { key: "mode", label: "MODE" },
        { key: "api_url", label: "API URL" },
        { key: "has_key", label: "KEY" },
      ]);
    }));

  ap
    .command("current")
    .description("Show the active Access Point")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const config = loadConfig();
      const current = config.current_access_point || null;
      const active = current ? config.access_points?.[current] : null;
      const legacy = config.active_access_point || null;
      if (out.json) {
        out.success({
          current_access_point: current,
          access_point: active,
          legacy_access_point: legacy,
        });
        return;
      }
      if (!active && !legacy) {
        out.info("No active Access Point. Run `puppyone ap login <profile>`.");
        return;
      }
      const display = active || legacy;
      out.kv([
        ["Profile:", current || "(legacy)"],
        ["Name:", display.name || "-"],
        ["API URL:", display.api_url || "-"],
        ["Scope:", display.scope?.path || "."],
        ["Mode:", display.scope?.mode || "-"],
        ["Key:", current ? (getAccessPointCredential(current) ? "stored" : "missing") : maskKey(legacy?.access_key)],
      ]);
    }));

  ap
    .command("logout")
    .description("Delete a saved Access Point profile and local credential")
    .argument("<profile>", "local profile name")
    .action(withErrors(async (profile, opts, cmd) => {
      validateProfileName(profile);
      const out = createOutput(cmd);
      const config = loadConfig();
      const profiles = { ...(config.access_points || {}) };
      delete profiles[profile];
      deleteAccessPointCredential(profile);
      saveConfig({
        access_points: profiles,
        current_access_point: config.current_access_point === profile ? null : config.current_access_point,
      });
      out.success?.({ deleted: profile });
      out.info(`Access Point profile deleted: ${profile}`);
    }));

  ap
    .command("clear")
    .description("Clear the active Access Point selection")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      saveConfig({ current_access_point: null, active_access_point: null });
      out.success?.({ current_access_point: null });
      out.info("Active Access Point selection cleared.");
    }));
}

function registerFsCommands(ap) {
  ap
    .command("ls")
    .description("List directory contents within the access point scope")
    .argument("[path]", "path relative to the access point scope")
    .option("-l, --long", "detailed output (size, type, hash)")
    .action(withErrors(async (path, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createApClient(cmd);
      const headers = await _extraHeaders(cmd);
      const result = await _get(client, "/ap-fs/ls", { path: scopedPath(path) }, headers);
      const entries = result.entries || [];

      if (out.json) {
        out.success({ ...result, entries });
        return;
      }
      if (!entries.length) {
        out.info("  (empty directory)");
        return;
      }

      if (opts.long) {
        out.table(entries.map(e => ({
          type: e.type,
          name: e.name,
          path: e.path,
          size: e.type === "folder" ? `${e.children_count ?? "?"} items` : formatSize(e.size_bytes),
          hash: e.content_hash ? e.content_hash.substring(0, 8) : "-",
        })), [
          { key: "type", label: "TYPE" },
          { key: "name", label: "NAME" },
          { key: "size", label: "SIZE" },
          { key: "hash", label: "HASH" },
        ]);
      } else {
        for (const e of entries) {
          const detail = e.type === "folder" ? `${e.children_count ?? "?"} items` : formatSize(e.size_bytes);
          out.info(`  ${typeIcon(e.type)} ${e.name.padEnd(30)} ${detail}`);
        }
      }
    }));

  ap
    .command("tree")
    .description("Show directory tree within the access point scope")
    .argument("[path]", "path relative to the access point scope")
    .option("-d, --depth <n>", "max depth (-1 = unlimited)", "-1")
    .action(withErrors(async (path, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createApClient(cmd);
      const headers = await _extraHeaders(cmd);
      const cleanPath = scopedPath(path);
      const result = await _get(client, "/ap-fs/tree", {
        path: cleanPath,
        max_depth: opts.depth,
      }, headers);
      const entries = result.entries || [];

      if (out.json) {
        out.success(result);
        return;
      }
      if (!entries.length) {
        out.info("  (empty)");
        return;
      }
      for (const e of entries) {
        const depth = e.path ? e.path.split("/").length - (cleanPath ? cleanPath.split("/").length : 0) - 1 : 0;
        const indent = "  ".repeat(Math.max(0, depth));
        out.info(`  ${indent}${typeIcon(e.type)} ${e.name}`);
      }
    }));

  ap
    .command("cat")
    .description("Read a file within the access point scope")
    .argument("<path>", "file path relative to the access point scope")
    .action(withErrors(async (path, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createApClient(cmd);
      const headers = await _extraHeaders(cmd);
      const result = await _get(client, "/ap-fs/cat", { path: scopedPath(path) }, headers);

      if (out.json) {
        out.success(result);
        return;
      }
      if (result.content != null) {
        out.raw(typeof result.content === "string" ? result.content : JSON.stringify(result.content, null, 2));
      } else if (result.content_text != null) {
        out.raw(result.content_text);
      }
    }));

  ap
    .command("stat")
    .description("Show file or directory information within the access point scope")
    .argument("[path]", "path relative to the access point scope")
    .action(withErrors(async (path, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createApClient(cmd);
      const headers = await _extraHeaders(cmd);
      const result = await _get(client, "/ap-fs/stat", { path: scopedPath(path) }, headers);

      if (out.json) {
        out.success(result);
        return;
      }
      if (!result.exists) {
        out.error("NOT_FOUND", `Path not found: ${scopedPath(path) || "."}`);
        return;
      }
      out.kv([
        ["Path:", result.path || "."],
        ["MUT Path:", result.mut_path || "-"],
        ["Type:", result.type],
        ["Size:", formatSize(result.size_bytes)],
        ["MIME:", result.mime_type ?? "-"],
        ["Hash:", result.content_hash ?? "-"],
        ["Children:", result.children_count != null ? String(result.children_count) : "-"],
      ]);
    }));

  ap
    .command("write")
    .description("Write a file within the access point scope")
    .argument("<path>", "destination path relative to the access point scope")
    .option("--content <text>", "inline content string")
    .option("--file <local-path>", "read content from a local file")
    .option("--type <type>", "node type: json | markdown | file (auto-detected from extension)")
    .option("-m, --message <msg>", "commit message")
    .action(withErrors(async (path, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createApClient(cmd);
      const headers = await _extraHeaders(cmd);
      const cleanPath = scopedPath(path);

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

      const result = await _post(client, "/ap-fs/write", {
        path: cleanPath,
        content,
        node_type: nodeType,
        message: opts.message || `ap edit ${cleanPath}`,
      }, headers);

      out.info(`Written: ${result.path ?? cleanPath} ${shortCommit(result.commit_id)}`);
      out.success(result);
    }));

  ap
    .command("mkdir")
    .description("Create a directory within the access point scope")
    .argument("<path>", "directory path relative to the access point scope")
    .action(withErrors(async (path, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createApClient(cmd);
      const headers = await _extraHeaders(cmd);
      const cleanPath = scopedPath(path);
      const result = await _post(client, "/ap-fs/mkdir", { path: cleanPath }, headers);
      out.info(`Directory created: ${result.path ?? cleanPath} ${shortCommit(result.commit_id)}`);
      out.success(result);
    }));

  ap
    .command("mv")
    .description("Move or rename within the access point scope")
    .argument("<src>", "source path relative to the access point scope")
    .argument("<dst>", "destination path relative to the access point scope")
    .option("-m, --message <msg>", "commit message")
    .action(withErrors(async (src, dst, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createApClient(cmd);
      const headers = await _extraHeaders(cmd);
      const oldPath = scopedPath(src);
      const newPath = scopedPath(dst);
      const result = await _post(client, "/ap-fs/mv", {
        old_path: oldPath,
        new_path: newPath,
        message: opts.message || `ap move ${oldPath} -> ${newPath}`,
      }, headers);
      out.info(`Moved: ${oldPath} -> ${newPath} ${shortCommit(result.commit_id)}`);
      out.success(result);
    }));

  ap
    .command("rm")
    .description("Delete within the access point scope (moves to trash by default)")
    .argument("<path>", "path relative to the access point scope")
    .option("-f, --force", "permanently delete (skip trash)")
    .action(withErrors(async (path, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createApClient(cmd);
      const headers = await _extraHeaders(cmd);
      const cleanPath = scopedPath(path);
      const result = await _post(client, "/ap-fs/rm", {
        path: cleanPath,
        permanent: !!opts.force,
      }, headers);
      out.info(`${opts.force ? "Deleted permanently" : "Moved to trash"}: ${cleanPath} ${shortCommit(result.commit_id)}`);
      out.success(result);
    }));
}

function maskKey(key) {
  if (!key || key.length < 8) return key || "-";
  const idx = key.indexOf("_");
  const pre = idx > 0 ? idx + 1 : 4;
  return key.slice(0, pre) + "..." + key.slice(-4);
}

async function readAccessKey(opts) {
  if (opts.accessKey) return opts.accessKey;
  if (opts.accessKeyStdin) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const key = Buffer.concat(chunks).toString("utf-8").trim();
    if (!key) throw new ApiError(0, "MISSING_ACCESS_KEY", "No access key received on stdin.");
    return key;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new ApiError(
      0,
      "MISSING_ACCESS_KEY",
      "Access key is required in non-interactive mode.",
      "Pipe it with --access-key-stdin or set PUPPYONE_ACCESS_KEY for one command.",
    );
  }
  return readHiddenLine("Access Key: ");
}

function readHiddenLine(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = "";
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    };

    const onData = (char) => {
      if (char === "\r" || char === "\n") {
        stdin.off("data", onData);
        cleanup();
        resolve(value.trim());
        return;
      }
      if (char === "\u0003") {
        stdin.off("data", onData);
        cleanup();
        process.exit(130);
      }
      if (char === "\u007f" || char === "\b") {
        value = value.slice(0, -1);
        return;
      }
      value += char;
    };

    stdin.on("data", onData);
  });
}

async function _extraHeaders(cmd) {
  const opts = collectOpts(cmd);
  return opts.mutUser ? { "X-Mut-User": opts.mutUser } : {};
}

async function _get(client, path, query, headers = {}) {
  if (!Object.keys(headers).length) return client.get(path, query);
  return _requestWithExtraHeaders(client, "GET", path, null, query, headers);
}

async function _post(client, path, body, headers = {}) {
  if (!Object.keys(headers).length) return client.post(path, body);
  return _requestWithExtraHeaders(client, "POST", path, body, null, headers);
}

async function _requestWithExtraHeaders(client, method, path, body, query, extraHeaders) {
  const url = new URL(`${client.baseUrl}/api/v1${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value != null) url.searchParams.set(key, String(value));
    }
  }
  const authHeaders = await client.getAuthHeaders();
  const res = await fetch(url, {
    method,
    headers: { ...authHeaders, ...extraHeaders, "Content-Type": "application/json" },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.detail ?? parsed.message ?? text;
    } catch {}
    throw new ApiError(res.status, "API_ERROR", detail);
  }
  const json = await res.json();
  if (json.code !== 0) {
    throw new ApiError(0, "API_BIZ_ERROR", json.message ?? "Unknown error");
  }
  return json.data;
}
