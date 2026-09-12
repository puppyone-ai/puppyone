import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertExecutableIdentity,
  resolveFirstExecutable,
} from "../../../../../electron/main/agent/connections/probes/executable-candidates.mjs";
import {
  createProbeEnvironment,
  runBoundedProbeCommand,
} from "../../../../../electron/main/agent/connections/probes/bounded-probe-command.mjs";
import {
  inspectCodexProtocol,
  parseCodexLocalVersion,
  probeCodexLocal,
} from "../../../../../electron/main/agent/connections/probes/codex-local-probe.mjs";
import {
  parseCursorAuthentication,
  parseCursorLocalVersion,
  probeCursorLocal,
} from "../../../../../electron/main/agent/connections/probes/cursor-local-probe.mjs";
import {
  parseVersionedLocalAgentVersion,
  probeVersionedLocalAgent,
} from "../../../../../electron/main/agent/connections/probes/versioned-local-agent-probe.mjs";
import { createLocalAgentInventory } from "../../../../../electron/main/agent/connections/local-agent-inventory.mjs";
import { deriveLocalConnection } from "../../../../../electron/main/agent/connections/local-agent-connection-policy.mjs";
import { localAgentToolRegistryDefaults } from "../../../../../electron/main/agent/connections/tools/local-agent-tool-registry.mjs";
import { CLAUDE_LOCAL_TOOL } from "../../../../../electron/main/agent/connections/tools/claude-tool.mjs";
import { OPENCODE_LOCAL_TOOL } from "../../../../../electron/main/agent/connections/tools/opencode-tool.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Desktop Agent local-tool inventory", () => {
  it("finds GUI-missing PATH installations from a bounded user registry and deduplicates aliases", async () => {
    const home = await temporaryDirectory();
    const bin = path.join(home, ".local", "bin");
    await mkdir(bin, { recursive: true });
    const cursorAgent = await executable(path.join(bin, "cursor-agent"));
    await symlink(cursorAgent, path.join(bin, "agent"));

    const candidate = await resolveFirstExecutable({
      names: ["cursor-agent", "agent"],
      env: { PATH: "" },
      homedir: home,
      platform: process.platform,
    });

    const canonicalCursorAgent = await realpath(cursorAgent);
    expect(candidate).toMatchObject({
      invokedAs: "cursor-agent",
      executablePath: canonicalCursorAgent,
      canonicalIdentity: canonicalCursorAgent,
      source: "user-installation",
    });
    await expect(assertExecutableIdentity(candidate)).resolves.toBe(canonicalCursorAgent);
  });

  it("rejects a candidate whose canonical identity changes before launch", async () => {
    const home = await temporaryDirectory();
    const first = await executable(path.join(home, "first"));
    const second = await executable(path.join(home, "second"));

    await expect(assertExecutableIdentity({
      executablePath: first,
      canonicalIdentity: second,
    })).rejects.toThrow(/changed identity/i);
  });

  it("accepts configured paths with spaces and skips broken or non-executable candidates", async () => {
    const home = await temporaryDirectory();
    const configuredDirectory = path.join(home, "CLI tools");
    await mkdir(configuredDirectory, { recursive: true });
    const configured = await executable(path.join(configuredDirectory, "codex"));
    const resolved = await resolveFirstExecutable({
      names: ["codex"],
      configuredPaths: [configured],
      env: { PATH: "" },
      homedir: home,
      platform: process.platform,
    });
    expect(resolved).toMatchObject({ invokedAs: "codex", source: "configured" });

    const bin = path.join(home, ".local", "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, "plain"), "not executable", "utf8");
    await symlink(path.join(home, "missing"), path.join(bin, "broken"));
    await expect(resolveFirstExecutable({
      names: ["broken", "plain"],
      env: { PATH: "" },
      homedir: home,
      platform: process.platform,
    })).resolves.toBeNull();
  });

  it("uses a minimal probe environment and never forwards credential-shaped variables", () => {
    const environment = createProbeEnvironment({
      HOME: "/Users/example",
      PATH: "/usr/bin",
      TMPDIR: "/tmp",
      LANG: "en_US.UTF-8",
      OPENAI_API_KEY: "secret",
      CURSOR_API_KEY: "secret",
      AWS_SECRET_ACCESS_KEY: "secret",
    });

    expect(environment).toMatchObject({
      HOME: "/Users/example",
      PATH: "/usr/bin",
      TMPDIR: "/tmp",
      LANG: "en_US.UTF-8",
      TERM: "dumb",
      PUPPYONE_AGENT_PROBE: "1",
    });
    expect(JSON.stringify(environment)).not.toContain("secret");
    expect(environment).not.toHaveProperty("OPENAI_API_KEY");
    expect(environment).not.toHaveProperty("CURSOR_API_KEY");
  });

  it("kills a probe that exceeds its timeout or combined output budget", async () => {
    vi.useFakeTimers();
    const hanging = fakeChild();
    const timeoutPromise = runBoundedProbeCommand("/absolute/tool", ["--version"], {
      spawn: () => hanging,
      timeoutMs: 10,
      maxOutputBytes: 16 * 1024,
    });
    const timeoutExpectation = expect(timeoutPromise).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(11);
    await timeoutExpectation;
    expect(hanging.kill).toHaveBeenCalled();

    vi.useRealTimers();
    const noisy = fakeChild();
    const overflowPromise = runBoundedProbeCommand("/absolute/tool", ["status"], {
      spawn: () => noisy,
      timeoutMs: 1_500,
      maxOutputBytes: 32,
    });
    noisy.stdout.write("x".repeat(33));
    await expect(overflowPromise).rejects.toThrow(/safety limit/i);
    expect(noisy.kill).toHaveBeenCalled();
  });

  it("normalizes Codex and Cursor versions plus negative-first Cursor authentication", () => {
    expect(parseCodexLocalVersion("codex-cli 0.144.1")).toBe("0.144.1");
    expect(parseCursorLocalVersion("2026.07.09-a3815c0")).toBe("2026.07.09-a3815c0");
    expect(parseCursorAuthentication("Not authenticated. Run cursor-agent login.")).toBe("signed-out");
    expect(parseCursorAuthentication("Not authenticated: credentials expired.")).toBe("expired");
    expect(parseCursorAuthentication("Authenticated as local@example.test")).toBe("signed-in");
    expect(parseCursorAuthentication("ERROR: SecItemCopyMatching failed -50")).toBe("error");
    expect(parseCursorAuthentication("new additive status format")).toBe("unknown");
  });

  it("registers every terminal-launched Agent and verifies generic local versions", async () => {
    expect(localAgentToolRegistryDefaults.map(({ id }) => id)).toEqual([
      "codex",
      "claude",
      "cursor-agent",
      "opencode",
    ]);
    expect(parseVersionedLocalAgentVersion("claude 2.1.159")).toBe("2.1.159");
    const result = await probeVersionedLocalAgent({
      candidate: fixedCandidate("/tools/claude", "claude"),
      id: "claude",
      displayName: "Claude Code",
      runCommand: vi.fn(async () => ({ code: 0, stdout: "2.1.159 (Claude Code)", stderr: "" })),
    });
    expect(result).toMatchObject({
      id: "claude",
      installation: "detected",
      version: "2.1.159",
      protocolCompatible: false,
    });
  });

  it("finds GUI-missing NVM Claude and standard OpenCode installations", async () => {
    const home = await temporaryDirectory();
    const claudePath = path.join(home, ".nvm", "versions", "node", "v22.17.0", "bin", "claude");
    const opencodePath = path.join(home, ".opencode", "bin", "opencode");
    await mkdir(path.dirname(claudePath), { recursive: true });
    await mkdir(path.dirname(opencodePath), { recursive: true });
    await executable(claudePath, "#!/bin/sh\necho '2.1.159 (Claude Code)'\n");
    await executable(opencodePath, "#!/bin/sh\necho 'opencode 1.2.3'\n");
    const inventory = createLocalAgentInventory({
      env: { PATH: "" },
      homedir: home,
      toolDescriptors: [CLAUDE_LOCAL_TOOL, OPENCODE_LOCAL_TOOL],
    });

    await expect(inventory.discover({ refresh: true })).resolves.toMatchObject({
      connections: [
        { id: "claude", installation: "detected", version: "2.1.159" },
        { id: "opencode", installation: "detected", version: "1.2.3" },
      ],
    });
    inventory.dispose();
  });

  it("probes Codex protocol/account and Cursor status without exposing raw output", async () => {
    const candidate = fixedCandidate("/tools/codex", "codex");
    const codex = await probeCodexLocal({
      candidate,
      runCommand: vi.fn(async () => ({ code: 0, stdout: "codex-cli 0.144.1", stderr: "" })),
      inspectProtocol: vi.fn(async () => ({
        authentication: "signed-in",
        protocolCompatible: true,
        hasModels: true,
      })),
    });
    expect(codex).toMatchObject({
      installation: "detected",
      version: "0.144.1",
      authentication: "signed-in",
      protocolCompatible: true,
      hasModels: true,
    });

    const cursor = await probeCursorLocal({
      candidate: fixedCandidate("/tools/cursor-agent", "cursor-agent"),
      runCommand: vi.fn(async (_file, args) => args[0] === "--version"
        ? { code: 0, stdout: "2026.07.09-a3815c0", stderr: "" }
        : { code: 0, stdout: "Authenticated as private@example.test", stderr: "" }),
    });
    expect(cursor).toMatchObject({
      installation: "detected",
      version: "2026.07.09-a3815c0",
      authentication: "signed-in",
    });
    expect(JSON.stringify(cursor)).not.toContain("private@example.test");
  });

  it("retains a Cursor status crash as probe evidence instead of treating it as sign-out", async () => {
    const cursor = await probeCursorLocal({
      candidate: fixedCandidate("/tools/cursor-agent", "cursor-agent"),
      runCommand: vi.fn(async (_file, args) => args[0] === "--version"
        ? { code: 0, stdout: "2026.07.09-a3815c0", stderr: "" }
        : { code: 139, signal: null, stdout: "", stderr: "ERROR: SecItemCopyMatching failed -50" }),
    });

    expect(cursor).toMatchObject({
      installation: "detected",
      authentication: "error",
      authenticationFailure: "crashed",
      authenticationExitCode: 139,
      authenticationDiagnostic: expect.stringMatching(/exit code 139.*SecItemCopyMatching failed -50/i),
    });
    expect(deriveLocalConnection(cursor)).toMatchObject({
      authentication: "error",
      integration: "blocked",
      selectable: false,
    });
  });

  it("disposes an in-flight Codex protocol probe when application inventory is cancelled", async () => {
    const controller = new AbortController();
    let rejectRequest;
    const connection = {
      on: vi.fn(),
      notify: vi.fn(),
      request: vi.fn(() => new Promise((_resolve, reject) => { rejectRequest = reject; })),
      dispose: vi.fn(() => rejectRequest?.(new Error("connection closed"))),
    };
    const pending = inspectCodexProtocol({
      candidate: fixedCandidate("/tools/codex", "codex"),
      appVersion: "0.1.2",
      workspaceRoot: "/workspace",
      env: {},
      signal: controller.signal,
      connectionFactory: () => connection,
    });
    await vi.waitFor(() => expect(connection.request).toHaveBeenCalledWith(
      "initialize",
      expect.any(Object),
      { timeoutMs: 1_500 },
    ));
    controller.abort();
    await expect(pending).rejects.toThrow(/connection closed/i);
    expect(connection.dispose).toHaveBeenCalledWith("Codex inventory probe cancelled.");
  });

  it("keeps unsupported Codex and signed-out Cursor visible without running an integration route", async () => {
    const inspectProtocol = vi.fn();
    const codex = await probeCodexLocal({
      candidate: fixedCandidate("/tools/codex", "codex"),
      runCommand: vi.fn(async () => ({ code: 0, stdout: "codex-cli 0.100.0", stderr: "" })),
      inspectProtocol,
    });
    expect(codex).toMatchObject({ installation: "unsupported", version: "0.100.0", authentication: "unknown" });
    expect(inspectProtocol).not.toHaveBeenCalled();

    const cursor = await probeCursorLocal({
      candidate: fixedCandidate("/tools/cursor-agent", "cursor-agent"),
      runCommand: vi.fn(async (_file, args) => args[0] === "--version"
        ? { code: 0, stdout: "2026.07.09-a3815c0", stderr: "" }
        : { code: 1, stdout: "", stderr: "Not authenticated. Run cursor-agent login." }),
    });
    expect(cursor).toMatchObject({ installation: "detected", authentication: "signed-out" });
    expect(deriveLocalConnection(cursor)).toMatchObject({ integration: "setup-required", selectable: false });
  });

  it("derives native selectability from protocol, auth, model and workspace gates", () => {
    const detected = {
      id: "codex",
      displayName: "Codex",
      installation: "detected",
      version: "0.144.1",
      authentication: "signed-in",
      protocolCompatible: true,
      hasModels: true,
      source: "user-installation",
    };
    expect(deriveLocalConnection(detected)).toMatchObject({
      integration: "ready",
      selectable: true,
    });
    expect(deriveLocalConnection(detected, {
      workspaceAllowed: false,
    })).toMatchObject({ integration: "setup-required", selectable: false });
  });

  it("deduplicates concurrent scans, caches for five minutes and isolates per-tool failure", async () => {
    const now = vi.fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_001)
      .mockReturnValueOnce(301_001);
    let releaseCodex;
    const codexResult = {
      id: "codex",
      displayName: "Codex",
      installation: "detected",
      version: "0.144.1",
      authentication: "signed-in",
      protocolCompatible: true,
      hasModels: true,
      source: "user-installation",
    };
    const codexProbe = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { releaseCodex = resolve; }))
      .mockResolvedValue(codexResult);
    const cursorProbe = vi.fn(async () => { throw new Error("private cursor output /Users/example"); });
    const inventory = createLocalAgentInventory({
      now,
      resolveCandidate: vi.fn(async (tool) => fixedCandidate(`/tools/${tool.id}`, tool.executableNames[0])),
      probes: { codex: codexProbe, "cursor-agent": cursorProbe },
    });

    const first = inventory.discover();
    const concurrent = inventory.discover();
    await vi.waitFor(() => expect(codexProbe).toHaveBeenCalledTimes(1));
    expect(codexProbe).toHaveBeenCalledTimes(1);
    releaseCodex(codexResult);
    const [snapshot, sameSnapshot] = await Promise.all([first, concurrent]);
    expect(sameSnapshot).toEqual(snapshot);
    expect(snapshot.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "codex", selectable: true }),
      expect.objectContaining({ id: "cursor-agent", installation: "broken", selectable: false }),
    ]));
    expect(JSON.stringify(snapshot)).not.toMatch(/\/Users\/example|\/tools\/|private cursor output/);

    await inventory.discover();
    expect(codexProbe).toHaveBeenCalledTimes(1);
    await inventory.discover({ refresh: true });
    expect(codexProbe).toHaveBeenCalledTimes(2);
  });

  it("lets explicit Refresh supersede an in-flight scan without caching aborted failures", async () => {
    const ready = {
      id: "codex",
      displayName: "Codex",
      installation: "detected",
      version: "0.144.1",
      authentication: "signed-in",
      protocolCompatible: true,
      hasModels: true,
      source: "user-installation",
    };
    const probe = vi.fn(({ signal }) => probe.mock.calls.length === 1
      ? new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
        const error = new Error("cancelled");
        error.name = "AbortError";
        reject(error);
      }, { once: true }))
      : Promise.resolve(ready));
    const inventory = createLocalAgentInventory({
      toolDescriptors: [{
        id: "codex",
        displayName: "Codex",
        executableNames: ["codex"],
        unavailableMessage: "Codex unavailable.",
        probe,
      }],
      resolveCandidate: vi.fn(async () => fixedCandidate("/tools/codex", "codex")),
    });

    const first = inventory.discover();
    const firstRejection = expect(first).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
    const refreshed = inventory.discover({ refresh: true });

    await firstRejection;
    await expect(refreshed).resolves.toMatchObject({
      connections: [expect.objectContaining({ id: "codex", selectable: true })],
    });
    expect(probe).toHaveBeenCalledTimes(2);
    inventory.dispose();
  });

  it("reuses a sanitized persisted inventory snapshot across application restarts", async () => {
    const directory = await temporaryDirectory();
    const cacheFilePath = path.join(directory, "agent-runtime-inventory.json");
    const firstProbe = vi.fn(async () => ({
      id: "codex",
      displayName: "Codex",
      installation: "detected",
      version: "0.144.1",
      authentication: "signed-in",
      protocolCompatible: true,
      hasModels: true,
      source: "user-installation",
    }));
    const descriptor = {
      id: "codex",
      displayName: "Codex",
      executableNames: ["codex"],
      unavailableMessage: "Codex unavailable.",
      probe: firstProbe,
    };
    const first = createLocalAgentInventory({
      now: () => 1_000,
      cacheFilePath,
      toolDescriptors: [descriptor],
      resolveCandidate: vi.fn(async () => fixedCandidate("/tools/codex", "codex")),
    });
    const scanned = await first.discover();
    expect(firstProbe).toHaveBeenCalledTimes(1);
    const persisted = await readFile(cacheFilePath, "utf8");
    expect(persisted).not.toMatch(/\/tools\/codex|executablePath|environment|credential/i);
    if (process.platform !== "win32") expect((await stat(cacheFilePath)).mode & 0o777).toBe(0o600);
    first.dispose();

    const restartedProbe = vi.fn(async () => { throw new Error("must not rescan"); });
    const restarted = createLocalAgentInventory({
      now: () => 2_000,
      cacheFilePath,
      toolDescriptors: [{ ...descriptor, probe: restartedProbe }],
      resolveCandidate: vi.fn(async () => fixedCandidate("/changed/codex", "codex")),
    });
    await expect(restarted.discover()).resolves.toEqual(scanned);
    expect(restartedProbe).not.toHaveBeenCalled();

    await restarted.discover({ refresh: true });
    expect(restartedProbe).toHaveBeenCalledTimes(1);
    restarted.dispose();
  });

  it("adds a new inventory tool through one validated descriptor without changing inventory orchestration", async () => {
    const inventory = createLocalAgentInventory({
      toolDescriptors: [{
        id: "claude-code",
        displayName: "Claude Code",
        executableNames: ["claude"],
        unavailableMessage: "Claude Code native SDK is unavailable.",
        probe: vi.fn(async () => ({
          id: "claude-code",
          displayName: "Claude Code",
          installation: "detected",
          version: "2.1.0",
          authentication: "signed-in",
          protocolCompatible: true,
          hasModels: true,
          source: "user-installation",
        })),
      }],
      resolveCandidate: vi.fn(async () => fixedCandidate("/tools/claude", "claude")),
    });

    const snapshot = await inventory.discover({ refresh: true });

    expect(snapshot.connections).toEqual([
      expect.objectContaining({
        id: "claude-code",
        displayName: "Claude Code",
        integration: "ready",
        selectable: true,
        statusMessage: expect.stringContaining("ready for native Agent sessions"),
      }),
    ]);
    inventory.dispose();
  });
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "puppyone-agent-inventory-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function executable(filename, contents = "#!/bin/sh\nexit 0\n") {
  await writeFile(filename, contents, "utf8");
  await chmod(filename, 0o755);
  return filename;
}

function fixedCandidate(executablePath, invokedAs) {
  return {
    executablePath,
    canonicalIdentity: executablePath,
    invokedAs,
    argsPrefix: [],
    source: "user-installation",
  };
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  return child;
}
