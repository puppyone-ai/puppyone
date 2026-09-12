import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Agent activity architecture boundaries", () => {
  it("keeps provider payloads outside shared and Renderer code", () => {
    const shared = source("shared/agent-activity-contract/types.ts");
    const presence = source("src/features/desktop-agent-presence/ui/AgentFilePresence.tsx");
    expect(shared).not.toMatch(/tool_input|hook_event_name|Electron|React/);
    expect(presence).not.toMatch(/codex|claude|cursor|opencode|hermes|PreToolUse/iu);
  });

  it("keeps Editor and Explorer coupled only to the public presence feature", () => {
    const editor = source("src/features/editor-workbench/layout/EditorPaneShell.tsx");
    const workspace = source("src/features/app-shell/DesktopDataWorkspaceSurface.tsx");
    expect(editor).toContain("desktop-agent-presence");
    expect(workspace).toContain("desktop-agent-presence");
    expect(editor).not.toContain("desktop-terminal");
    expect(workspace).not.toContain("terminal-agent/activity");
  });

  it("keeps concrete providers in the Terminal adapter composition root", () => {
    const neutralHost = source("electron/main/agent-activity/bootstrap/create-agent-activity-host.mjs");
    const registry = source("electron/main/terminal-agent/activity/terminal-agent-activity-adapter-registry.mjs");
    expect(neutralHost).not.toMatch(/codex|claude|cursor|opencode|piActivity|hermes/iu);
    for (const provider of ["codex", "claude", "cursor", "opencode", "pi", "hermes"]) {
      expect(registry).toContain(`./adapters/${provider}/descriptor.mjs`);
    }
  });
});

function source(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}
