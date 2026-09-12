import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createClaudeSpawn } from "../../../../../electron/main/agent/runtimes/claude/claude-spawn.mjs";

describe("Claude Code Electron spawn adapter", () => {
  it("routes Node-backed CLI entrypoints through an absolute Node executable", () => {
    const spawn = vi.fn(() => fakeChild());
    const launch = createClaudeSpawn({
      spawn,
      fsModule: {
        constants: { X_OK: 1 },
        accessSync: vi.fn((filename) => {
          if (filename !== "/runtime/bin/node") throw new Error("missing");
        }),
      },
    });

    launch({
      command: "/tools/claude/cli.js",
      args: ["--output-format", "stream-json"],
      cwd: "/workspace",
      env: { PATH: "/runtime/bin" },
    });

    expect(spawn).toHaveBeenCalledWith(
      "/runtime/bin/node",
      ["/tools/claude/cli.js", "--output-format", "stream-json"],
      expect.objectContaining({ cwd: "/workspace", shell: false }),
    );
  });

  it("closes every owned process and waits for exit before releasing the SDK adapter", async () => {
    const children = [];
    const launch = createClaudeSpawn({ spawn: () => { const child = fakeChild(); children.push(child); return child; } });
    const controller = new AbortController();
    const options = { command: "/tools/claude", args: [], cwd: "/workspace", env: {} };
    launch({ ...options, signal: controller.signal });
    launch(options);
    controller.abort();
    expect(children[0].kill).toHaveBeenCalledWith("SIGTERM");
    let closed = false;
    const disposing = launch.dispose().then(() => { closed = true; });
    children[0].emit("close", 0, null);
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(children[1].kill).toHaveBeenCalledWith("SIGTERM");
    children[1].emit("close", 0, null);
    await disposing;
    expect(closed).toBe(true);
    expect(() => launch(options)).toThrow(/owner has closed/);
    await launch.dispose();
  });

  it("rejects relative commands and control characters before spawning", () => {
    const spawn = vi.fn(() => fakeChild());
    const launch = createClaudeSpawn({ spawn });

    expect(() => launch({
      command: "claude",
      args: [],
      cwd: "/workspace",
      env: { PATH: "/usr/bin" },
    })).toThrow("absolute validated path");
    expect(() => launch({
      command: "/tools/claude",
      args: ["--model\nunsafe"],
      cwd: "/workspace",
      env: {},
    })).toThrow("arguments are invalid");
    expect(spawn).not.toHaveBeenCalled();
  });
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  return child;
}
