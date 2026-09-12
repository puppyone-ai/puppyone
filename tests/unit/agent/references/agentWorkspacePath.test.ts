import { describe, expect, it } from "vitest";
import { resolveAgentWorkspaceProviderPath } from "../../../../src/features/desktop-agent/domain/agent-workspace-path";

describe("Agent Workspace navigation path", () => {
  it("converts absolute paths inside the assigned Workspace Folder", () => {
    expect(resolveAgentWorkspaceProviderPath(
      "/Users/example/To-Do-List",
      "/Users/example/To-Do-List/guanqun.md",
    )).toBe("guanqun.md");
  });

  it("keeps provider-relative paths and resolves harmless dot segments", () => {
    expect(resolveAgentWorkspaceProviderPath(
      "/Users/example/To-Do-List",
      "docs/./notes/../guanqun.md",
    )).toBe("docs/guanqun.md");
  });

  it("does not route an absolute path through the wrong Workspace Folder", () => {
    expect(resolveAgentWorkspaceProviderPath(
      "/Users/example/project-a",
      "/Users/example/project-b/guanqun.md",
    )).toBeNull();
    expect(resolveAgentWorkspaceProviderPath(
      "/Users/example/project-a",
      "../project-b/guanqun.md",
    )).toBeNull();
  });

  it("supports Windows paths case-insensitively", () => {
    expect(resolveAgentWorkspaceProviderPath(
      "C:\\Users\\Example\\Project",
      "c:\\users\\example\\project\\src\\App.tsx",
    )).toBe("src/App.tsx");
  });
});
