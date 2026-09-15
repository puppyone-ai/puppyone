import { describe, expect, it, vi } from "vitest";
import { discoverCursorBackend } from "../../../../../electron/main/agent/runtimes/cursor/cursor-discovery.mjs";
import { buildUserOpenCodeEnvironment } from "../../../../../electron/main/agent/runtimes/opencode-native/opencode-native-discovery.mjs";
import { publicRuntimeReadiness } from "../../../../../electron/main/agent/runtime/agent-runtime-registry.mjs";
import {
  CLAUDE_CODE_TESTED_BASELINE,
  discoverClaudeRuntime,
  parseClaudeVersion,
} from "../../../../../electron/main/agent/runtimes/claude/claude-discovery.mjs";

describe("native Agent backend discovery", () => {
  it("accepts only an explicit Claude Code version line", () => {
    expect(parseClaudeVersion("1.0.73 (Claude Code)\n")).toBe("1.0.73");
    expect(parseClaudeVersion("Claude Code 2.1.159\n")).toBe("2.1.159");
    expect(parseClaudeVersion("Error: denied\nNode.js v22.17.0\n")).toBeNull();
  });

  it("keeps the user's OpenCode profile separate from PuppyOne Agent's managed profile", () => {
    const environment = buildUserOpenCodeEnvironment({
      HOME: "/home/user",
      PATH: "/usr/bin",
      OPENCODE_CONFIG_DIR: "/home/user/.config/opencode-custom",
      OPENCODE_TEST_HOME: "/home/user/.opencode-test-home",
      XDG_CONFIG_HOME: "/home/user/.config",
    }, { OPENCODE_API_KEY: "secret" });

    expect(environment.OPENCODE_CONFIG_DIR).toBe("/home/user/.config/opencode-custom");
    expect(environment.OPENCODE_TEST_HOME).toBe("/home/user/.opencode-test-home");
    expect(environment.XDG_CONFIG_HOME).toBe("/home/user/.config");
    expect(environment.OPENCODE_API_KEY).toBe("secret");
    expect(environment.PUPPYONE_AGENT_BACKEND).toBe("opencode-native");
    expect(environment.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("1");
    expect(environment.OPENCODE_PURE).toBeUndefined();
  });

  it("makes an authenticated Cursor Agent selectable through its ACP entrypoint", async () => {
    const readiness = await discoverCursorBackend({
      resolveCandidate: vi.fn(async () => ({ executablePath: "/usr/local/bin/cursor-agent", source: "user-installation" })),
      probe: vi.fn(async () => ({ installation: "detected", version: "2026.07.09", authentication: "signed-in", source: "user-installation" })),
    });

    expect(readiness).toMatchObject({ runtimeId: "cursor", status: "ready", compatibility: "acp-v1" });
    expect(publicRuntimeReadiness({ descriptor: { id: "cursor" }, readiness })).toMatchObject({
      status: "ready",
      selectable: true,
    });
  });

  it("keeps the native Claude backend unavailable when the user's CLI is not installed", async () => {
    const readiness = await discoverClaudeRuntime({
      fsModule: {
        constants: { X_OK: 1 },
        promises: {
          access: vi.fn(async () => { throw new Error("missing"); }),
          realpath: vi.fn(),
        },
      },
      spawn: vi.fn(),
      env: { PATH: "" },
      platform: "darwin",
      homedir: "/home/test",
      sdkLoader: vi.fn(async () => ({ query() {}, getSessionMessages() {} })),
    });
    expect(readiness).toMatchObject({
      status: "not-installed",
      source: "missing",
      executablePath: null,
      minimumVersion: CLAUDE_CODE_TESTED_BASELINE,
    });
  });

  it("isolates Claude version probing from the user's real profile", async () => {
    const removed = [];
    const spawn = vi.fn((_file, args, options) => fakeChild(args[0] === "--version"
      ? { stdout: "2.1.159 (Claude Code)\n" }
      : { stdout: secureClaudeHelp() }, options));
    const readiness = await discoverClaudeRuntime({
      fsModule: {
        constants: { X_OK: 1 },
        promises: {
          access: vi.fn(async () => {}),
          realpath: vi.fn(async () => "/tools/claude"),
          stat: vi.fn(async () => ({ dev: 1, ino: 2, isFile: () => true, mtimeMs: 3, size: 4 })),
          mkdtemp: vi.fn(async (prefix) => `${prefix}test`),
          rm: vi.fn(async (directory, options) => { removed.push([directory, options]); }),
        },
      },
      spawn,
      env: { PATH: "/tools", HOME: "/home/test", CLAUDE_CONFIG_DIR: "/home/test/.claude-custom" },
      platform: "darwin",
      homedir: "/home/test",
      tmpdir: "/tmp",
      sdkLoader: vi.fn(async () => ({ query() {}, getSessionMessages() {} })),
    });

    expect(readiness).toMatchObject({
      status: "ready",
      version: "2.1.159",
      environment: { CLAUDE_CONFIG_DIR: "/home/test/.claude-custom" },
    });
    const probeEnvironment = spawn.mock.calls[0][2].env;
    expect(probeEnvironment.CLAUDE_CONFIG_DIR).toMatch(/^\/tmp\/puppyone-claude-version-probe-/u);
    expect(probeEnvironment.CLAUDE_CONFIG_DIR).not.toBe(readiness.environment.CLAUDE_CONFIG_DIR);
    expect(removed).toHaveLength(2);
    expect(removed[0]).toEqual([probeEnvironment.CLAUDE_CONFIG_DIR, { recursive: true, force: true }]);
  });

  it("reports an installed Claude CLI with missing secure SDK controls without treating it as missing", async () => {
    const readiness = await discoverClaudeRuntime({
      fsModule: {
        constants: { X_OK: 1 },
        promises: {
          access: vi.fn(async () => {}),
          realpath: vi.fn(async () => "/tools/claude"),
          stat: vi.fn(async () => ({ dev: 1, ino: 2, isFile: () => true, mtimeMs: 3, size: 4 })),
          mkdtemp: vi.fn(async (prefix) => `${prefix}test`),
          rm: vi.fn(async () => {}),
        },
      },
      spawn: vi.fn((_file, args, options) => fakeChild(args[0] === "--version"
        ? { stdout: "1.0.73 (Claude Code)\n" }
        : { stdout: "--input-format --output-format --permission-mode" }, options)),
      env: { PATH: "/tools", HOME: "/home/test" },
      platform: "darwin",
      homedir: "/home/test",
      tmpdir: "/tmp",
      sdkLoader: vi.fn(async () => ({ query() {}, getSessionMessages() {} })),
    });

    expect(readiness).toMatchObject({
      status: "protocol-unavailable",
      version: "1.0.73",
      minimumVersion: CLAUDE_CODE_TESTED_BASELINE,
      source: "user-installed",
      compatibility: "unavailable",
    });
    expect(readiness.message).toMatch(/secure streaming controls/i);
  });
});

function secureClaudeHelp() {
  return "--input-format --output-format --setting-sources --permission-mode";
}

function fakeChild(result, options) {
  expect(options.shell).toBe(false);
  const listeners = new Map();
  const stdoutListeners = new Map();
  const stderrListeners = new Map();
  const child = {
    stdout: { on: (event, listener) => stdoutListeners.set(event, listener) },
    stderr: { on: (event, listener) => stderrListeners.set(event, listener) },
    once: (event, listener) => listeners.set(event, listener),
    kill: vi.fn(),
  };
  queueMicrotask(() => {
    if (result.stdout) stdoutListeners.get("data")?.(result.stdout);
    if (result.stderr) stderrListeners.get("data")?.(result.stderr);
    listeners.get("close")?.(result.code ?? 0, null);
  });
  return child;
}
