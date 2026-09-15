import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("first project starter architecture", () => {
  it("distinguishes a newly-created project from open, restore, and clone entry paths", () => {
    const lifecycle = source("src/features/app-shell/useWorkspaceLifecycle.ts");
    const app = source("src/App.tsx");

    expect(lifecycle).toContain('handleWorkspaceOpenResult(result, "created")');
    expect(lifecycle).toContain('handleWorkspaceOpenResult(result, "cloned")');
    expect(lifecycle).toContain('entryKind: WorkspaceEntryKind = "opened"');
    expect(app).toContain("experimentalSettings.enableFirstProjectStarter");
    expect(app).toContain('activeWorkspaceEntryKind === "created"');
  });

  it("keeps starter writes explicit, root-qualified, and outside the workspace tree renderer", () => {
    const surface = source("src/features/app-shell/DesktopDataWorkspaceSurface.tsx");
    const dialog = source("src/features/app-shell/EmptyWorkspaceOnboardingDialog.tsx");

    expect(surface).toContain("qualifyDataResourcePath(activeWorkspaceRootPath, selection.file.path)");
    expect(surface).toContain("await dataPort.createFile(resourcePath, selection.file.content)");
    expect(surface).toContain("workspaceFolderId: folder.id");
    expect(dialog).toContain('id: "blank"');
    expect(dialog).toContain('file: null');
    expect(dialog).not.toContain("createFolder(");
  });
});

function source(relativePath: string) {
  return readFileSync(new URL(`../../../../${relativePath}`, import.meta.url), "utf8");
}
