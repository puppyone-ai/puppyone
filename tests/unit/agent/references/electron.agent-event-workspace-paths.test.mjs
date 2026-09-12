import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAgentEventJournal } from "../../../../electron/main/agent/application/agent-event-journal.mjs";
import { createAgentSessionRecord } from "../../../../electron/main/agent/domain/agent-session-model.mjs";
import {
  normalizeAgentEventWorkspacePaths,
  normalizeAgentWorkspaceEventPath,
} from "../../../../electron/main/agent/domain/agent-event-workspace-paths.mjs";

describe("Agent event workspace path policy", () => {
  it("normalizes absolute Codex file-change paths before Renderer delivery", () => {
    const root = "/Users/example/project";
    const original = {
      type: "file.change.updated",
      payload: {
        label: "Edit /Users/example/project/docs/notes.md",
        path: "/Users/example/project/docs/notes.md",
        changes: [{
          path: "/Users/example/project/docs/notes.md",
          additions: 1,
          deletions: 0,
        }],
        input: {
          changes: [{ path: "/Users/example/project/src/App.tsx", kind: "update" }],
        },
      },
    };

    expect(normalizeAgentEventWorkspacePaths(original, root, path.posix)).toEqual({
      type: "file.change.updated",
      payload: {
        label: "Edit docs/notes.md",
        path: "docs/notes.md",
        changes: [{ path: "docs/notes.md", additions: 1, deletions: 0 }],
        input: { changes: [{ path: "src/App.tsx", kind: "update" }] },
      },
    });
    expect(original.payload.path).toBe("/Users/example/project/docs/notes.md");
  });

  it("fails closed for paths owned by another Workspace Folder", () => {
    const event = {
      type: "tool.completed",
      payload: {
        label: "Edit /Users/example/project-b/private.md",
        path: "/Users/example/project-b/private.md",
        changes: [{ path: "/Users/example/project-b/private.md" }],
      },
    };

    expect(normalizeAgentEventWorkspacePaths(event, "/Users/example/project-a", path.posix)).toEqual({
      type: "tool.completed",
      payload: {
        label: "Edit private.md",
        changes: [],
      },
    });
  });

  it("supports native Windows workspace paths without weakening containment", () => {
    expect(normalizeAgentWorkspaceEventPath(
      "C:\\Users\\example\\project",
      "C:\\Users\\example\\project\\docs\\notes.md",
      path.win32,
    )).toBe("docs/notes.md");
    expect(normalizeAgentWorkspaceEventPath(
      "C:\\Users\\example\\project",
      "C:\\Users\\example\\other\\notes.md",
      path.win32,
    )).toBeNull();
  });

  it("normalizes live delivery and migrates persisted replay events", () => {
    const workspaceRoot = "/Users/example/project";
    const sender = { isDestroyed: () => false, send: vi.fn() };
    const session = createAgentSessionRecord({
      id: "session-1",
      ownerId: 1,
      sender,
      workspaceRoot,
      runtimeId: "codex",
      runtime: { id: "codex", displayName: "Codex" },
      model: null,
      effort: null,
      mode: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      title: "Codex session",
      events: [eventEnvelope("/Users/example/project/old.md")],
    });
    expect(session.events[0].payload.path).toBe("old.md");

    const journal = createAgentEventJournal({
      sessionCache: { save: vi.fn(async () => undefined) },
    });
    journal.emit(session, {
      type: "file.change.updated",
      payload: {
        path: "/Users/example/project/new.md",
        changes: [{ path: "/Users/example/project/new.md" }],
      },
    });

    expect(session.events.at(-1)).toEqual(expect.objectContaining({
      payload: {
        path: "new.md",
        changes: [{ path: "new.md" }],
      },
    }));
    expect(sender.send).not.toHaveBeenCalled();
    clearTimeout(session.persistTimer);
  });
});

function eventEnvelope(filePath) {
  return {
    schemaVersion: 1,
    sequence: 1,
    sessionId: "session-1",
    runtimeId: "codex",
    provider: "codex",
    providerSessionId: null,
    turnId: "turn-1",
    itemId: "item-1",
    emittedAt: "2026-09-01T00:00:00.000Z",
    type: "file.change.updated",
    payload: { path: filePath, changes: [{ path: filePath }] },
  };
}
