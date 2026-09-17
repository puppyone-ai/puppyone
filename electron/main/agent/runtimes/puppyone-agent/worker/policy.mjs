import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PUPPYONE_AGENT_APPROVAL_PROTOCOL } from "../puppyone-agent-kernel.mjs";
import { BUILT_IN_AGENT_DISPLAY_NAME } from "../puppyone-agent-public-identity.mjs";

const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const WRITE_TOOLS = new Set(["edit", "write"]);
const COMMAND_TOOLS = new Set(["bash", "powershell"]);

/** The only extension loaded by the managed worker. */
export function createPuppyOnePolicyExtension({ workspaceRoot, fsModule = fs } = {}) {
  const root = path.resolve(workspaceRoot);
  return {
    name: "puppyone-policy",
    hidden: true,
    factory(pi) {
      pi.on("tool_call", async (event, ctx) => {
        const toolName = canonicalToolName(event.toolName);
        const target = toolPath(event.input);
        if ((READ_TOOLS.has(toolName) || WRITE_TOOLS.has(toolName)) && target) {
          const authorized = await isAuthorizedWorkspacePath(root, target, fsModule);
          if (!authorized) return { block: true, terminate: true, reason: "PuppyOne blocked a tool path outside the assigned project." };
        }
        if (READ_TOOLS.has(toolName)) return undefined;

        const request = approvalRequest(event, toolName);
        const confirmed = await ctx.ui.confirm(
          PUPPYONE_AGENT_APPROVAL_PROTOCOL,
          JSON.stringify(request),
          { signal: ctx.signal },
        );
        if (confirmed) return undefined;
        return { block: true, reason: "The user declined this tool action." };
      });
    },
  };
}

export async function isAuthorizedWorkspacePath(workspaceRoot, requestedPath, fsModule = fs) {
  const root = await canonicalExistingPath(path.resolve(workspaceRoot), fsModule);
  const candidate = path.resolve(workspaceRoot, requestedPath);
  const canonical = await canonicalPotentialPath(candidate, fsModule);
  const relative = path.relative(root, canonical);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function approvalRequest(event, toolName) {
  const input = boundedValue(event.input);
  const command = COMMAND_TOOLS.has(toolName) && typeof input.command === "string" ? input.command : null;
  const kind = COMMAND_TOOLS.has(toolName) ? "command" : WRITE_TOOLS.has(toolName) ? "file-change" : "tool";
  const target = toolPath(input);
  const subject = command || target || toolName;
  const title = kind === "command" ? "Run command" : kind === "file-change" ? "Change project files" : `Use ${toolName}`;
  return {
    schema: PUPPYONE_AGENT_APPROVAL_PROTOCOL,
    toolCallId: safeId(event.toolCallId),
    toolName,
    kind,
    title,
    description: subject ? String(subject).slice(0, 2_000) : `${BUILT_IN_AGENT_DISPLAY_NAME} requested a tool action.`,
    reason: `${BUILT_IN_AGENT_DISPLAY_NAME} requires approval before commands, file mutations, or non-read-only tools.`,
    command,
    arguments: input,
    scopeKey: approvalScope(toolName, input),
    allowSession: true,
  };
}

function approvalScope(toolName, input) {
  const subject = COMMAND_TOOLS.has(toolName) ? input.command : toolPath(input);
  return `${toolName}:${crypto.createHash("sha256").update(JSON.stringify(subject ?? input)).digest("hex")}`;
}

async function canonicalPotentialPath(candidate, fsModule) {
  try { return await canonicalExistingPath(candidate, fsModule); }
  catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const parent = path.dirname(candidate);
    if (parent === candidate) throw error;
    return path.join(await canonicalPotentialPath(parent, fsModule), path.basename(candidate));
  }
}

async function canonicalExistingPath(candidate, fsModule) {
  return fsModule.promises.realpath(candidate);
}

function canonicalToolName(value) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[\s_-]+/gu, "") : "tool";
}

function toolPath(value) {
  const candidate = value?.path ?? value?.filePath ?? value?.file_path;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function boundedValue(value, depth = 0) {
  if (depth > 4) return "[nested]";
  if (typeof value === "string") return value.slice(0, 8_192);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 32).map((entry) => boundedValue(entry, depth + 1));
  if (!value || typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value).slice(0, 64).map(([key, entry]) => [
    key.slice(0, 120), boundedValue(entry, depth + 1),
  ]));
}

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,256}$/u.test(value) ? value : null;
}
