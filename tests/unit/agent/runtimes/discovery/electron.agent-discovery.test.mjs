import { describe, expect, it, vi } from "vitest";
import {
  compareVersions,
  discoverCodexExecutable,
  MIN_SUPPORTED_CODEX_VERSION,
  parseCodexVersion,
} from "../../../../../electron/main/agent/runtimes/codex/codex-discovery.mjs";

describe("Codex provider discovery", () => {
  it("parses and classifies semantic versions", () => {
    expect(parseCodexVersion("codex-cli 0.144.1")).toBe("0.144.1");
    expect(parseCodexVersion("unexpected")).toBeNull();
    expect(compareVersions("0.144.1", "0.100.0")).toBe(1);
    expect(compareVersions("0.99.0", "0.100.0")).toBe(-1);
    expect(compareVersions("0.100.0", "0.100.0")).toBe(0);
    expect(MIN_SUPPORTED_CODEX_VERSION).toBe("0.144.1");
  });

  it("returns ready using deterministic paths without executing a login shell", async () => {
    const spawn = vi.fn(() => createCompletedChild("codex-cli 0.144.1\n"));
    const fsModule = {
      constants: { X_OK: 1 },
      promises: {
        access: vi.fn(async (candidate) => {
          if (candidate !== "/usr/local/bin/codex") throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }),
        realpath: vi.fn(async (candidate) => candidate),
      },
    };
    const readiness = await discoverCodexExecutable({
      fsModule,
      spawn,
      env: { SHELL: "/bin/zsh", PATH: "" },
      platform: "darwin",
      homedir: "/Users/test",
    });
    expect(readiness).toMatchObject({ status: "ready", version: "0.144.1", executablePath: "/usr/local/bin/codex" });
    expect(spawn.mock.calls.every((call) => call[2]?.shell === false)).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0][1]).toEqual(["--version"]);
    expect(readiness.environment.PATH).toContain("/Users/test/.local/bin");
  });

  it("classifies missing and older installations", async () => {
    const missing = await discoverCodexExecutable({
      fsModule: {
        constants: { X_OK: 1 },
        promises: {
          access: vi.fn(async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }),
          realpath: vi.fn(),
        },
      },
      spawn: vi.fn(() => createCompletedChild("PATH=/usr/local/bin\0")),
      env: { SHELL: "/bin/zsh" },
      platform: "darwin",
      homedir: "/Users/test",
    });
    expect(missing.status).toBe("not-installed");

    const spawn = vi.fn(() => createCompletedChild("codex-cli 0.90.0\n"));
    const older = await discoverCodexExecutable({
      fsModule: {
        constants: { X_OK: 1 },
        promises: {
          access: vi.fn(async (candidate) => {
            if (candidate !== "/usr/local/bin/codex") throw new Error("missing");
          }),
          realpath: vi.fn(async (candidate) => candidate),
        },
      },
      spawn,
      env: { SHELL: "/bin/zsh" },
      platform: "darwin",
      homedir: "/Users/test",
    });
    expect(older).toMatchObject({ status: "unsupported-version", version: "0.90.0" });
  });
});

function createCompletedChild(stdoutValue) {
  const listeners = new Map();
  const stream = () => ({
    on(event, listener) {
      if (event === "data" && stdoutValue) queueMicrotask(() => listener(stdoutValue));
    },
  });
  const child = {
    stdout: stream(),
    stderr: { on() {} },
    kill: vi.fn(),
    once(event, listener) {
      listeners.set(event, listener);
      if (event === "close") queueMicrotask(() => listener(0, null));
    },
  };
  return child;
}
