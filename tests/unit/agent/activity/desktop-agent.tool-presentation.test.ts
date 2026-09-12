import { describe, expect, it } from "vitest";
import { commandPresentationForActivity, outputForActivity } from "../../../../src/features/desktop-agent/domain/agent-activity-presentation";
import type { AgentActivity } from "../../../../src/features/desktop-agent/domain/agent-projection-types";

describe("Desktop Agent Shell presentation semantics", () => {
  it.each([
    ["/bin/zsh -lc \"rg -n needle src\"", "grep", "Grep", true],
    ["rg --files src", "glob", "Glob", true],
    ["git grep needle", "grep", "Grep", true],
    ["cat src/App.tsx", "read", "Read", true],
    ["find src -name '*.ts'", "glob", "Glob", true],
  ] as const)("classifies a simple read-only command: %s", (command, tool, title, viaShell) => {
    expect(commandPresentationForActivity(activity(command))).toMatchObject({ tool, title, viaShell });
  });

  it.each([
    "cat src/App.tsx > /tmp/copy",
    "find src -delete",
    "find src -exec rm {} ;",
    "rg --pre 'node preprocess.js' needle",
    "rg needle src | xargs rm",
  ])("keeps ambiguous or mutating shell syntax as Bash: %s", (command) => {
    expect(commandPresentationForActivity(activity(command))).toMatchObject({ tool: "bash", title: "Bash", viaShell: false });
  });

  it("renders a structured tool result even when an adapter supplies no preview", () => {
    expect(outputForActivity({
      ...activity("tool"),
      kind: "mcp",
      detail: {
        tool: "lookup",
        result: {
          content: [
            { type: "text", text: "visible result" },
            { type: "artifact", uri: "artifact://report" },
            { type: "json", value: { count: 2 } },
          ],
          error: null,
        },
      },
    })).toContain("visible result\nartifact://report\n{\n  \"count\": 2\n}");
  });
});

function activity(command: string): AgentActivity {
  return {
    id: "command",
    turnId: "turn",
    itemId: "tool",
    kind: "command",
    label: command,
    status: "completed",
    detail: { tool: "bash", command },
    output: "",
    sequence: 1,
  };
}
