import { describe, expect, it } from "vitest";
import { createTerminalPtyRequest } from "../../../../src/features/desktop-terminal/runtime/terminalRuntime";

describe("Terminal PTY capability requests", () => {
  it.each([1, 2, 3])(
    "binds every request when %i Terminal session(s) start together",
    (sessionCount) => {
      const workspacePath = "/workspace/attached-root";
      const requests = Array.from({ length: sessionCount }, (_, index) => (
        createTerminalPtyRequest({
          sessionId: `terminal-${index + 1}`,
          launcherId: index % 2 === 0 ? "codex" : "shell",
          workspacePath,
          cols: 80 + index,
          rows: 24 + index,
          defaultColors: null,
        })
      ));

      expect(requests).toHaveLength(sessionCount);
      expect(new Set(requests.map(({ id }) => id)).size).toBe(sessionCount);
      expect(requests.every(({ rootPath, cwd }) => (
        rootPath === workspacePath && cwd === workspacePath
      ))).toBe(true);
      expect(requests.map(({ cols, rows }) => ({ cols, rows }))).toEqual(
        Array.from({ length: sessionCount }, (_, index) => ({
          cols: 80 + index,
          rows: 24 + index,
        })),
      );
    },
  );

  it("preserves the explicit Folder and presentation colors without sharing request state", () => {
    const first = createTerminalPtyRequest({
      sessionId: "terminal-first",
      launcherId: "codex",
      workspacePath: "/workspace/first",
      cols: 100,
      rows: 30,
      defaultColors: {
        foreground: [240, 240, 240],
        background: [20, 20, 20],
      },
    });
    const second = createTerminalPtyRequest({
      sessionId: "terminal-second",
      launcherId: "claude",
      workspacePath: "/workspace/second",
      cols: 120,
      rows: 40,
      defaultColors: null,
    });

    expect(first).toEqual({
      id: "terminal-first",
      rootPath: "/workspace/first",
      cwd: "/workspace/first",
      cols: 100,
      rows: 30,
      launcherId: "codex",
      defaultColors: {
        foreground: [240, 240, 240],
        background: [20, 20, 20],
      },
    });
    expect(second).toEqual({
      id: "terminal-second",
      rootPath: "/workspace/second",
      cwd: "/workspace/second",
      cols: 120,
      rows: 40,
      launcherId: "claude",
      defaultColors: undefined,
    });
    expect(first).not.toBe(second);
  });
});
