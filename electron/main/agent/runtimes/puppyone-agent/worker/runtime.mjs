import fs from "node:fs";
import path from "node:path";
import {
  ModelRuntime,
  SettingsManager,
  VERSION,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createBashToolDefinition,
  createPowerShellToolDefinition,
  runRpcMode,
} from "@earendil-works/pi-coding-agent";
import { PUPPYONE_AGENT_SYSTEM_PROMPT, PUPPYONE_PI_KERNEL } from "../puppyone-agent-kernel.mjs";
import { stripPuppyOneProviderCredentials } from "../puppyone-agent-environment.mjs";
import { WORKSPACE_AGENT_DISPLAY_NAME } from "../puppyone-agent-public-identity.mjs";
import { createPuppyOnePolicyExtension } from "./policy.mjs";
import { resolvePuppyOneSession } from "./session-resolver.mjs";

export function puppyOneWorkerProbe() {
  return Object.freeze({
    schema: "puppyone-pi-worker-probe/v1",
    product: "puppyone-agent",
    sdk: "@earendil-works/pi-coding-agent",
    version: VERSION,
    expectedVersion: PUPPYONE_PI_KERNEL.version,
    protocol: PUPPYONE_PI_KERNEL.protocol,
    node: process.versions.node,
    ready: VERSION === PUPPYONE_PI_KERNEL.version && nodeVersionAtLeast(process.versions.node, PUPPYONE_PI_KERNEL.minimumNodeVersion),
  });
}

export async function runPuppyOneAgentWorker({
  argv = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd(),
  fsModule = fs,
} = {}) {
  const options = parseWorkerArguments(argv);
  const profilePath = requireAbsolutePath(env.PUPPYONE_AGENT_HOME, "PUPPYONE_AGENT_HOME");
  const agentDir = path.join(profilePath, "pi");
  const sessionDir = path.join(profilePath, "sessions");
  await Promise.all([
    fsModule.promises.mkdir(agentDir, { recursive: true, mode: 0o700 }),
    fsModule.promises.mkdir(sessionDir, { recursive: true, mode: 0o700 }),
  ]);

  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
  });
  const createRuntime = async ({ cwd: runtimeCwd, sessionManager, sessionStartEvent }) => {
    const toolConfiguration = managedTools(runtimeCwd, process.platform);
    const settingsManager = SettingsManager.inMemory({
      defaultProjectTrust: "never",
      defaultTools: toolConfiguration.names,
      quietStartup: true,
    }, { projectTrusted: false });
    const services = await createAgentSessionServices({
      cwd: runtimeCwd,
      agentDir,
      modelRuntime,
      settingsManager,
      resourceLoaderOptions: {
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        appendSystemPrompt: [PUPPYONE_AGENT_SYSTEM_PROMPT],
        extensionFactories: [createPuppyOnePolicyExtension({ workspaceRoot: runtimeCwd, fsModule })],
      },
    });
    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        tools: toolConfiguration.names,
        customTools: toolConfiguration.custom,
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };
  const sessionManager = await resolvePuppyOneSession({
    cwd,
    sessionDir,
    sessionId: options.sessionId,
    inMemory: options.noSession,
  });
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager,
  });
  return runRpcMode(runtime);
}

export function parseWorkerArguments(argv) {
  const values = Array.isArray(argv) ? argv.slice(0, 16) : [];
  let noSession = false;
  let sessionId = null;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--mode") {
      if (values[++index] !== "rpc") throw new Error(`${WORKSPACE_AGENT_DISPLAY_NAME} worker supports only Pi RPC mode.`);
    } else if (value === "--no-approve") {
      // Compatibility flag owned by the shared Pi RPC launcher. Policy remains enabled.
    } else if (value === "--no-session") {
      noSession = true;
    } else if (value === "--session") {
      sessionId = validSessionId(values[++index]);
    } else {
      throw new Error(`Unsupported ${WORKSPACE_AGENT_DISPLAY_NAME} worker argument: ${String(value).slice(0, 120)}`);
    }
  }
  if (noSession && sessionId) throw new Error(`${WORKSPACE_AGENT_DISPLAY_NAME} cannot combine --no-session and --session.`);
  return Object.freeze({ noSession, sessionId });
}

function managedTools(cwd, platform) {
  const commandName = platform === "win32" ? "powershell" : "bash";
  const createCommandTool = platform === "win32" ? createPowerShellToolDefinition : createBashToolDefinition;
  return Object.freeze({
    names: Object.freeze(["read", commandName, "edit", "write", "grep", "find", "ls"]),
    custom: Object.freeze([createCommandTool(cwd, {
      spawnHook: (context) => ({
        ...context,
        env: stripPuppyOneProviderCredentials(context.env),
      }),
    })]),
  });
}

function requireAbsolutePath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || /[\r\n\0]/u.test(value)) {
    throw new TypeError(`${label} must be an absolute path.`);
  }
  return path.resolve(value);
}

function validSessionId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,200}$/u.test(value)) {
    throw new TypeError(`${WORKSPACE_AGENT_DISPLAY_NAME} session id is invalid.`);
  }
  return value;
}

function nodeVersionAtLeast(actual, minimum) {
  const left = String(actual).split(".").map(Number);
  const right = String(minimum).split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}
