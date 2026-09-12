import { describe, expect, it } from "vitest";
import {
  createWorkspaceContentChange,
  createWorkspaceResourceUri,
  createWorkspaceRootUri,
  workspaceContentChangeMatchesResource,
} from "@puppyone/shared-ui";

describe("editor pane resource invalidation", () => {
  const firstRoot = createWorkspaceRootUri("first");
  const secondRoot = createWorkspaceRootUri("second");

  it("matches Workbench Resource URIs without throwing in render-time predicates", () => {
    const event = createWorkspaceContentChange({
      sequence: 4,
      rootUri: firstRoot,
      paths: ["notes/today.md"],
    });
    const changed = createWorkspaceResourceUri(firstRoot, "notes/today.md");
    const unchanged = createWorkspaceResourceUri(firstRoot, "notes/other.md");

    expect(() => workspaceContentChangeMatchesResource(event, changed)).not.toThrow();
    expect(workspaceContentChangeMatchesResource(event, changed)).toBe(true);
    expect(workspaceContentChangeMatchesResource(event, unchanged)).toBe(false);
  });

  it("does not alias equal provider paths across Workspace Folders", () => {
    const event = createWorkspaceContentChange({
      sequence: 5,
      rootUri: firstRoot,
      paths: ["README.md"],
    });

    expect(workspaceContentChangeMatchesResource(
      event,
      createWorkspaceResourceUri(firstRoot, "README.md"),
    )).toBe(true);
    expect(workspaceContentChangeMatchesResource(
      event,
      createWorkspaceResourceUri(secondRoot, "README.md"),
    )).toBe(false);
  });

  it("scopes unknown-path bulk invalidation to the originating Folder", () => {
    const event = createWorkspaceContentChange({
      sequence: 6,
      rootUri: firstRoot,
      paths: null,
    });

    expect(workspaceContentChangeMatchesResource(
      event,
      createWorkspaceResourceUri(firstRoot, "notes/today.md"),
    )).toBe(true);
    expect(workspaceContentChangeMatchesResource(
      event,
      createWorkspaceResourceUri(secondRoot, "notes/today.md"),
    )).toBe(false);
  });

  it("retains standalone provider-relative matching outside a Workbench", () => {
    expect(workspaceContentChangeMatchesResource(
      createWorkspaceContentChange({
        sequence: 7,
        rootUri: null,
        paths: ["notes\\today.md"],
      }),
      "notes/today.md",
    )).toBe(true);
    expect(workspaceContentChangeMatchesResource(
      createWorkspaceContentChange({ sequence: 8, rootUri: null, paths: [] }),
      "notes/today.md",
    )).toBe(false);
  });

  it("fails closed instead of crashing on malformed events", () => {
    const resource = createWorkspaceResourceUri(firstRoot, "No3D");
    const malformed = {
      sequence: 9,
      entries: [{
        sequence: 9,
        rootUri: firstRoot,
        paths: ["puppyone-local:/broken"],
      }],
    };

    expect(() => workspaceContentChangeMatchesResource(malformed, resource)).not.toThrow();
    expect(workspaceContentChangeMatchesResource(malformed, resource)).toBe(false);
    const legacyShape = { sequence: 10, rootUri: firstRoot, paths: ["No3D"] };
    expect(() => workspaceContentChangeMatchesResource(
      legacyShape as never,
      resource,
    )).not.toThrow();
    expect(workspaceContentChangeMatchesResource(legacyShape as never, resource)).toBe(false);
  });

  it("degrades malformed watcher paths to a safe scoped refresh at ingestion", () => {
    const event = createWorkspaceContentChange({
      sequence: 10,
      rootUri: firstRoot,
      paths: ["../outside.md"],
    });

    expect(event.entries[0]?.paths).toBeNull();
    expect(workspaceContentChangeMatchesResource(
      event,
      createWorkspaceResourceUri(firstRoot, "notes/today.md"),
    )).toBe(true);
  });
});
