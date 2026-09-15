import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installBrokenStdioGuards,
  isBrokenStdioWriteError,
} from "../../../../electron/main/stdio-guard.mjs";

describe("broken stdio guards", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recognizes write EIO / EPIPE as broken-stdio errors", () => {
    expect(isBrokenStdioWriteError({ code: "EIO", syscall: "write" })).toBe(true);
    expect(isBrokenStdioWriteError({ code: "EPIPE", syscall: "write" })).toBe(true);
    expect(isBrokenStdioWriteError({ code: "EIO", message: "write EIO" })).toBe(true);
    expect(isBrokenStdioWriteError({ code: "EIO", syscall: "read" })).toBe(false);
    expect(isBrokenStdioWriteError({ code: "ENOENT", syscall: "write" })).toBe(false);
    expect(isBrokenStdioWriteError(null)).toBe(false);
  });

  it("swallows broken-pipe console.error instead of throwing", () => {
    const originalError = console.error;
    console.error = () => {
      const error = new Error("write EIO");
      error.code = "EIO";
      error.syscall = "write";
      throw error;
    };

    try {
      installBrokenStdioGuards({
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        on() {},
      });
      expect(() => console.error("replyWithError simulated")).not.toThrow();
    } finally {
      console.error = originalError;
    }
  });

  it("attaches listeners that ignore broken stdio stream errors", () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    installBrokenStdioGuards({
      stdout,
      stderr,
      on() {},
    });

    const eio = Object.assign(new Error("write EIO"), { code: "EIO", syscall: "write" });
    expect(() => stdout.emit("error", eio)).not.toThrow();
    expect(() => stderr.emit("error", eio)).not.toThrow();
  });
});
