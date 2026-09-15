import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { discoverPiExecutable } from "../../../../../electron/main/agent/runtimes/pi/pi-discovery.mjs";

describe("Pi runtime discovery", () => {
  it("requires the installed executable to expose the official RPC mode", async () => {
    const spawn = vi.fn((_executable, args) => createCompletedChild(
      args[0] === "--version"
        ? "0.84.3\n"
        : "Pi - AI coding assistant\n--mode <mode>  Output mode: text, json, or rpc\n",
    ));
    const readiness = await discoverPiExecutable({
      fsModule: executableFs("/opt/pi/bin/pi"),
      spawn,
      env: { PATH: "" },
      platform: "darwin",
      homedir: "/Users/test",
      configuredExecutable: "/opt/pi/bin/pi",
    });
    expect(readiness).toMatchObject({
      runtimeId: "pi",
      status: "ready",
      code: "READY",
      version: "0.84.3",
      executablePath: "/opt/pi/bin/pi",
      compatibility: "pi-rpc-v1",
    });
    expect(spawn.mock.calls.map((call) => call[1])).toEqual([["--version"], ["--help"]]);
    expect(spawn.mock.calls.every((call) => call[2]?.shell === false)).toBe(true);
  });

  it("distinguishes a missing runtime from an installed runtime without RPC support", async () => {
    const missing = await discoverPiExecutable({
      fsModule: executableFs(null),
      spawn: vi.fn(),
      env: { PATH: "" },
      platform: "darwin",
      homedir: "/Users/test",
    });
    expect(missing).toMatchObject({ status: "not-installed", code: "RUNTIME_NOT_INSTALLED" });

    const unsupported = await discoverPiExecutable({
      fsModule: executableFs("/opt/pi/bin/pi"),
      spawn: vi.fn((_executable, args) => createCompletedChild(args[0] === "--version" ? "0.84.3\n" : "Pi help\n")),
      env: { PATH: "" },
      platform: "darwin",
      homedir: "/Users/test",
      configuredExecutable: "/opt/pi/bin/pi",
    });
    expect(unsupported).toMatchObject({
      status: "protocol-unavailable",
      code: "PROTOCOL_UNAVAILABLE",
      compatibility: "unavailable",
    });
  });
});

function executableFs(existingPath) {
  return {
    constants: { X_OK: 1 },
    promises: {
      access: vi.fn(async (candidate) => {
        if (candidate !== existingPath) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }),
      realpath: vi.fn(async (candidate) => candidate),
      stat: vi.fn(async () => ({ dev: 1, ino: 2, isFile: () => true, mtimeMs: 3, size: 4 })),
    },
  };
}

function createCompletedChild(stdoutValue) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  queueMicrotask(() => {
    child.stdout.write(stdoutValue);
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);
  });
  return child;
}
