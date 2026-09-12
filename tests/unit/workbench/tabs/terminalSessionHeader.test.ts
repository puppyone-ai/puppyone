import { describe, expect, it } from "vitest";
import { presentTerminalSessionHeader } from "../../../../src/features/desktop-terminal/model/terminalSessionHeader";
import type { DesktopTerminalSessionSummary } from "../../../../src/features/desktop-terminal/model/terminalSessions";

describe("Terminal Session Header presentation", () => {
  it("projects one consistent identity for the rail and overflow menu", () => {
    const session: DesktopTerminalSessionSummary = {
      id: "terminal-a",
      launcherId: "codex",
      ordinal: 2,
      shell: "zsh",
      status: "running",
    };
    const presentation = presentTerminalSessionHeader(
      session,
      "/workspace/my private",
      (key, values) => {
        if (key === "terminal.sessionTitle") return `Terminal ${values?.number}`;
        if (key === "terminal.status.running") return "Running";
        if (key === "terminal.launcher.codex.name") return "Codex";
        return key;
      },
    );

    expect(presentation).toEqual({
      accessibleLabel: "Terminal 2 — Codex — /workspace/my private — Running",
      launcherLabel: "Codex",
      overflowDetail: "my private — Running",
      overflowLabel: "Codex",
      pathLabel: "my private",
      sessionTitle: "Terminal 2",
      statusLabel: "Running",
    });
  });

  it("uses the session identity while a launcher is still being selected", () => {
    const presentation = presentTerminalSessionHeader(
      {
        id: "launcher-a",
        launcherId: null,
        ordinal: 1,
        shell: null,
        status: "selecting",
      },
      "",
      (key, values) => {
        if (key === "terminal.sessionTitle") return `Terminal ${values?.number}`;
        if (key === "terminal.launcher.title") return "Start with an agent";
        return key;
      },
    );

    expect(presentation.overflowLabel).toBe("Terminal 1");
    expect(presentation.accessibleLabel).toBe(
      "Terminal 1 — Start with an agent",
    );
  });
});
