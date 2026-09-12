import { describe, expect, it } from "vitest";
import {
  MAX_WORKSPACE_CONTENT_CHANGE_ENTRIES,
  createWorkbenchWorkspace,
  createWorkspaceResourceUri,
  workspaceContentChangeMatchesResource,
  type Workspace,
  type WorkspaceContentChange,
} from "@puppyone/shared-ui";
import { appendWorkbenchWorkspaceContentChange } from "../../../../src/features/data-workspace/workbenchWorkspaceContentChange";

describe("Workbench Workspace mutation journal", () => {
  const workbench = createWorkbenchWorkspace([
    workspace("alpha", "/workspaces/alpha"),
    workspace("beta", "/workspaces/beta"),
  ]);
  const [alpha, beta] = workbench.folders;
  const alphaReadme = createWorkspaceResourceUri(alpha!.uri, "README.md");
  const betaReadme = createWorkspaceResourceUri(beta!.uri, "README.md");

  it("retains near-simultaneous changes from different roots in one React state snapshot", () => {
    let journal = emptyJournal();
    journal = appendWorkbenchWorkspaceContentChange(journal, workbench, {
      workspaceFolderId: alpha!.id,
      paths: ["README.md"],
    });
    journal = appendWorkbenchWorkspaceContentChange(journal, workbench, {
      workspaceFolderId: beta!.id,
      paths: ["README.md"],
    });

    expect(journal.sequence).toBe(2);
    expect(journal.entries).toHaveLength(2);
    expect(workspaceContentChangeMatchesResource(journal, alphaReadme, 0)).toBe(true);
    expect(workspaceContentChangeMatchesResource(journal, betaReadme, 0)).toBe(true);
    expect(workspaceContentChangeMatchesResource(journal, alphaReadme, 1)).toBe(false);
    expect(workspaceContentChangeMatchesResource(journal, betaReadme, 1)).toBe(true);
  });

  it("never aliases the same relative path across roots", () => {
    const journal = appendWorkbenchWorkspaceContentChange(emptyJournal(), workbench, {
      workspaceFolderId: alpha!.id,
      paths: ["README.md"],
    });

    expect(workspaceContentChangeMatchesResource(journal, alphaReadme, 0)).toBe(true);
    expect(workspaceContentChangeMatchesResource(journal, betaReadme, 0)).toBe(false);
  });

  it("turns a detached or unknown Folder event into a safe global refresh", () => {
    const journal = appendWorkbenchWorkspaceContentChange(emptyJournal(), workbench, {
      workspaceFolderId: "already-detached",
      paths: ["README.md"],
    });

    expect(journal.entries[0]).toMatchObject({ rootUri: null, paths: null });
    expect(workspaceContentChangeMatchesResource(journal, alphaReadme, 0)).toBe(true);
    expect(workspaceContentChangeMatchesResource(journal, betaReadme, 0)).toBe(true);
  });

  it("normalizes Windows separators and deduplicates repeated batch paths", () => {
    const journal = appendWorkbenchWorkspaceContentChange(emptyJournal(), workbench, {
      workspaceFolderId: alpha!.id,
      paths: ["notes\\today.md", "notes/today.md", "./notes/today.md"],
    });

    expect(journal.entries[0]?.paths).toEqual(["notes/today.md"]);
    expect(workspaceContentChangeMatchesResource(
      journal,
      createWorkspaceResourceUri(alpha!.uri, "notes/today.md"),
      0,
    )).toBe(true);
  });

  it("falls back to refresh instead of throwing for traversal or URI-shaped watcher paths", () => {
    for (const malformedPath of ["../outside.md", "puppyone-local:/broken"] as const) {
      const journal = appendWorkbenchWorkspaceContentChange(emptyJournal(), workbench, {
        workspaceFolderId: alpha!.id,
        paths: [malformedPath],
      });

      expect(journal.entries[0]).toMatchObject({ rootUri: alpha!.uri, paths: null });
      expect(() => workspaceContentChangeMatchesResource(journal, alphaReadme, 0)).not.toThrow();
      expect(workspaceContentChangeMatchesResource(journal, alphaReadme, 0)).toBe(true);
      expect(workspaceContentChangeMatchesResource(journal, betaReadme, 0)).toBe(false);
    }
  });

  it("uses a conservative refresh when a consumer falls behind the bounded journal", () => {
    let journal = emptyJournal();
    for (let index = 0; index <= MAX_WORKSPACE_CONTENT_CHANGE_ENTRIES; index += 1) {
      journal = appendWorkbenchWorkspaceContentChange(journal, workbench, {
        workspaceFolderId: alpha!.id,
        paths: [`generated/${index}.txt`],
      });
    }

    expect(journal.entries).toHaveLength(MAX_WORKSPACE_CONTENT_CHANGE_ENTRIES);
    expect(workspaceContentChangeMatchesResource(journal, betaReadme, 0)).toBe(true);
    expect(workspaceContentChangeMatchesResource(journal, betaReadme, journal.sequence - 1)).toBe(false);
  });
});

function emptyJournal(): WorkspaceContentChange {
  return { sequence: 0, entries: [] };
}

function workspace(id: string, path: string): Workspace {
  return {
    id,
    workspaceInstanceId: id,
    name: id,
    path,
    status: "recording",
  };
}
