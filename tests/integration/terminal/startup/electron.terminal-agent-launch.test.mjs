import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTerminalAgentLaunchResolver,
  isTerminalAgentLauncherId,
} from "../../../../electron/main/terminal-agent/terminal-agent-launch-resolver.mjs";
import { createTerminalService } from "../../../../electron/main/terminal-service.mjs";
import {
  isTerminalAgentDisplayReady,
  serializeTerminalAgentCommand,
} from "../../../../electron/main/terminal-shell-host.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe("Terminal Agent launch boundary", () => {
  it("maps renderer launcher ids through the trusted tool registry", async () => {
    const resolveCandidate = vi.fn(async (tool) => ({
      argsPrefix: tool.id === "cursor" ? ["agent"] : [],
      executablePath: `/tools/${tool.id}`,
      launchPathEntry: "/tools",
    }));
    const assertCandidate = vi.fn(async (candidate) => candidate.executablePath);
    const resolveLaunch = createTerminalAgentLaunchResolver({
      assertCandidate,
      resolveCandidate,
    });

    await expect(resolveLaunch("cursor")).resolves.toEqual({
      args: ["agent"],
      displayName: "Cursor Agent",
      executablePath: "/tools/cursor",
      pathEntries: [],
      environment: undefined,
    });
    expect(resolveCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cursor" }),
      expect.any(Object),
    );
    expect(assertCandidate).toHaveBeenCalledOnce();
    expect(isTerminalAgentLauncherId("codex")).toBe(true);
    expect(isTerminalAgentLauncherId("pi")).toBe(true);
    expect(isTerminalAgentLauncherId("hermes")).toBe(true);
    expect(isTerminalAgentLauncherId("anything; rm -rf /")).toBe(false);
  });

  it.each([
    ["pi", "Pi Agent", "/tools/pi"],
    ["hermes", "Hermes Agent", "/tools/hermes"],
  ])("resolves the %s catalog entry without product-specific launch code", async (
    launcherId,
    displayName,
    executablePath,
  ) => {
    const resolveLaunch = createTerminalAgentLaunchResolver({
      resolveCandidate: vi.fn(async (definition) => ({
        argsPrefix: [],
        executablePath: `/tools/${definition.id}`,
        launchPathEntry: "/tools",
      })),
      assertCandidate: vi.fn(async (candidate) => candidate.executablePath),
    });

    await expect(resolveLaunch(launcherId)).resolves.toEqual({
      args: [],
      displayName,
      executablePath,
      pathEntries: [],
      environment: undefined,
    });
  });

  it("rejects a stale inventory selection before creating a PTY", async () => {
    const workspaceRoot = await makeTemporaryDirectory();
    const ptyService = { spawn: vi.fn() };
    const service = createService({
      ptyService,
      resolveTerminalAgentLaunch: vi.fn(async () => {
        throw new Error("TERMINAL_AGENT_UNAVAILABLE");
      }),
    });

    await expect(service.create(createSender(), {
      id: "terminal_stale_agent",
      cwd: workspaceRoot,
      cols: 80,
      rows: 24,
      launcherId: "codex",
    }, workspaceRoot)).rejects.toThrow("TERMINAL_AGENT_UNAVAILABLE");
    expect(ptyService.spawn).not.toHaveBeenCalled();
  });

  it("starts the trusted Agent after shell initialization without writing launch text to stdin", async () => {
    const workspaceRoot = await makeTemporaryDirectory();
    const terminal = createFakeTerminal();
    const ptyService = { spawn: vi.fn(() => terminal) };
    const service = createService({
      environment: { PATH: "/usr/bin", SHELL: "/bin/zsh" },
      platform: "darwin",
      ptyService,
      resolveTerminalAgentLaunch: vi.fn(async () => ({
        args: ["agent"],
        displayName: "Cursor Agent",
        executablePath: "/verified/cursor",
        pathEntries: ["/verified"],
      })),
    });

    await expect(service.create(createSender(), {
      id: "terminal_cursor_agent",
      cwd: workspaceRoot,
      cols: 100,
      rows: 40,
      launcherId: "cursor",
    }, workspaceRoot)).resolves.toMatchObject({ shell: "Cursor Agent" });
    expect(ptyService.spawn).toHaveBeenCalledWith(
      "/bin/zsh",
      ["-l", "-i", "-c", "if '/verified/cursor' 'agent'; then :; fi; exec '/bin/zsh' -l"],
      expect.objectContaining({
        cwd: await realpath(workspaceRoot),
        env: expect.objectContaining({
          PATH: expect.stringMatching(/^\/verified:/u),
          DISABLE_AUTO_UPDATE: "true",
        }),
      }),
    );
    expect(terminal.write).not.toHaveBeenCalled();
  });

  it("keeps the shell session writable after bootstrapping an Agent", async () => {
    const workspaceRoot = await makeTemporaryDirectory();
    const terminal = createFakeTerminal();
    const sender = createSender();
    const service = createService({
      environment: { PATH: "/usr/bin", SHELL: "/bin/zsh" },
      platform: "darwin",
      ptyService: { spawn: vi.fn(() => terminal) },
      resolveTerminalAgentLaunch: vi.fn(async () => ({
        args: [],
        displayName: "Codex",
        executablePath: "/verified/codex",
      })),
    });

    await expect(service.create(sender, {
      id: "terminal_broken_agent",
      cwd: workspaceRoot,
      cols: 80,
      rows: 24,
      launcherId: "codex",
    }, workspaceRoot)).resolves.toMatchObject({ shell: "Codex" });

    expect(service.input(sender, {
      id: "terminal_broken_agent",
      data: "npm run dev\r",
    })).toBe(true);
    expect(terminal.write).toHaveBeenCalledExactlyOnceWith("npm run dev\r");
    expect(service.getSessionCount()).toBe(1);
  });

  it("keeps the startup cover until the Agent begins drawing its TUI", async () => {
    const workspaceRoot = await makeTemporaryDirectory();
    const terminal = createFakeTerminal();
    const service = createService({
      agentRevealTimeoutMs: 5_000,
      environment: { PATH: "/usr/bin", SHELL: "/bin/zsh" },
      platform: "darwin",
      ptyService: { spawn: vi.fn(() => terminal) },
      resolveTerminalAgentLaunch: vi.fn(async () => ({
        args: [],
        displayName: "OpenCode",
        executablePath: "/verified/opencode",
      })),
    });

    let resolved = false;
    const createPromise = service.create(createSender(), {
      id: "terminal_reveal_agent",
      cwd: workspaceRoot,
      cols: 80,
      rows: 24,
      launcherId: "opencode",
    }, workspaceRoot).then((result) => {
      resolved = true;
      return result;
    });

    await vi.waitFor(() => expect(terminal.onData).toHaveBeenCalledOnce());
    terminal.emitData("shell prompt and echoed command");
    await Promise.resolve();
    expect(resolved).toBe(false);

    terminal.emitData("\u001b[?1049h");
    await expect(createPromise).resolves.toMatchObject({ shell: "OpenCode" });
    expect(resolved).toBe(true);
  });

  it("answers startup default-color probes before forwarding Agent output", async () => {
    const workspaceRoot = await makeTemporaryDirectory();
    const terminal = createFakeTerminal();
    const sender = createSender();
    const service = createService({
      agentRevealTimeoutMs: 5_000,
      environment: { PATH: "/usr/bin", SHELL: "/bin/zsh" },
      platform: "darwin",
      ptyService: { spawn: vi.fn(() => terminal) },
      resolveTerminalAgentLaunch: vi.fn(async () => ({
        args: [],
        displayName: "Codex",
        executablePath: "/verified/codex",
      })),
    });

    const createPromise = service.create(sender, {
      id: "terminal_codex_colors",
      cwd: workspaceRoot,
      cols: 80,
      rows: 24,
      launcherId: "codex",
      defaultColors: {
        foreground: [109, 102, 93],
        background: [251, 250, 247],
      },
    }, workspaceRoot);

    await vi.waitFor(() => expect(terminal.onData).toHaveBeenCalledOnce());
    terminal.emitData(
      "before\u001b]10;?\u001b\\middle\u001b]11;?\u001b\\after\u001b[?1049h",
    );
    await expect(createPromise).resolves.toMatchObject({ shell: "Codex" });

    expect(terminal.write).toHaveBeenNthCalledWith(1, "\u001b]10;rgb:6d6d/6666/5d5d\u001b\\");
    expect(terminal.write).toHaveBeenNthCalledWith(2, "\u001b]11;rgb:fbfb/fafa/f7f7\u001b\\");
    expect(sender.send).toHaveBeenCalledWith("terminal:data", {
      id: "terminal_codex_colors",
      instanceId: expect.any(String),
      data: "beforemiddleafter\u001b[?1049h",
    });

    expect(service.appearance(sender, {
      id: "terminal_codex_colors",
      defaultColors: {
        foreground: [209, 206, 198],
        background: [22, 20, 19],
      },
    })).toBe(true);
    terminal.emitData("\u001b]10;?\u001b\\\u001b]11;?\u001b\\");
    expect(terminal.write).toHaveBeenNthCalledWith(3, "\u001b]10;rgb:d1d1/cece/c6c6\u001b\\");
    expect(terminal.write).toHaveBeenNthCalledWith(4, "\u001b]11;rgb:1616/1414/1313\u001b\\");
    expect(service.appearance({ ...createSender(), id: 52 }, {
      id: "terminal_codex_colors",
      defaultColors: {
        foreground: [0, 0, 0],
        background: [255, 255, 255],
      },
    })).toBe(false);
  });

  it("closes a fallback host shell if the Agent bootstrap cannot be written", async () => {
    const workspaceRoot = await makeTemporaryDirectory();
    const terminal = createFakeTerminal();
    terminal.write.mockImplementationOnce(() => {
      throw new Error("PTY input failed");
    });
    const service = createService({
      environment: { PATH: "/usr/bin", SHELL: "/bin/fish" },
      platform: "darwin",
      ptyService: { spawn: vi.fn(() => terminal) },
      resolveTerminalAgentLaunch: vi.fn(async () => ({
        args: [],
        displayName: "Codex",
        executablePath: "/verified/codex",
      })),
    });

    await expect(service.create(createSender(), {
      id: "terminal_failed_bootstrap",
      cwd: workspaceRoot,
      cols: 80,
      rows: 24,
      launcherId: "codex",
    }, workspaceRoot)).rejects.toThrow("TERMINAL_AGENT_START_FAILED");
    expect(terminal.kill).toHaveBeenCalledOnce();
    expect(service.getSessionCount()).toBe(0);
  });
});

describe("Terminal Agent command serialization", () => {
  it("preserves a Windows npm launcher path and refuses percent expansion", () => {
    expect(serializeTerminalAgentCommand({ executablePath: "C:\\CLI tools\\codex.cmd", args: [] },
      { platform: "win32", shellFile: "C:\\Windows\\System32\\cmd.exe" }))
      .toBe('"C:\\CLI tools\\codex.cmd"\r');
    expect(() => serializeTerminalAgentCommand({ executablePath: "C:\\%custom%\\codex.cmd" },
      { platform: "win32", shellFile: "C:\\Windows\\System32\\cmd.exe" })).toThrow("cannot preserve");
  });
  it("recognizes both TUI control sequences and substantial first paint output", () => {
    expect(isTerminalAgentDisplayReady("shell prompt and echoed command")).toBe(false);
    expect(isTerminalAgentDisplayReady("\u001b[?1049h")).toBe(true);
    expect(isTerminalAgentDisplayReady("x".repeat(384))).toBe(true);
  });

  it("quotes POSIX executable paths and arguments as inert shell words", () => {
    expect(serializeTerminalAgentCommand({
      executablePath: "/Applications/O'Code/opencode",
      args: ["--profile", "work space"],
    }, {
      platform: "darwin",
      shellFile: "/bin/zsh",
    })).toBe("'/Applications/O'\"'\"'Code/opencode' '--profile' 'work space'\r");
  });

  it("uses native PowerShell invocation syntax on Windows", () => {
    expect(serializeTerminalAgentCommand({
      executablePath: "C:\\Program Files\\OpenCode\\opencode.exe",
      args: ["--profile", "work space"],
    }, {
      platform: "win32",
      shellFile: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    })).toBe("& 'C:\\Program Files\\OpenCode\\opencode.exe' '--profile' 'work space'\r");
  });

  it("quotes native executable arguments for cmd.exe on Windows", () => {
    expect(serializeTerminalAgentCommand({
      executablePath: "C:\\Program Files\\OpenCode\\opencode.exe",
      args: ["--profile", "work space"],
    }, {
      platform: "win32",
      shellFile: "C:\\Windows\\System32\\cmd.exe",
    })).toBe('"C:\\Program Files\\OpenCode\\opencode.exe" "--profile" "work space"\r');
  });
});

function createService(options) {
  return createTerminalService({
    agentRevealTimeoutMs: 0,
    appVersion: "test",
    initializeWorkspaceEditReview: vi.fn(async () => undefined),
    logger: { warn: vi.fn() },
    ...options,
  });
}

async function makeTemporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "puppyone-terminal-agent-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createFakeTerminal() {
  let dataListener = null;
  let exitListener = null;
  return {
    pid: 123,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(() => exitListener?.({ exitCode: 0, signal: 15 })),
    onData: vi.fn((listener) => {
      dataListener = listener;
    }),
    onExit: vi.fn((listener) => { exitListener = listener; }),
    emitData(data) {
      dataListener?.(data);
    },
  };
}

function createSender() {
  return {
    id: 51,
    isDestroyed: () => false,
    send: vi.fn(),
  };
}
