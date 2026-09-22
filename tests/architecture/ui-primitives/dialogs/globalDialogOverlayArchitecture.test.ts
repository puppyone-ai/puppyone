import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FEATURE_OWNED_WINDOW_DIALOGS = [
  "src/features/automation/AutomationCreateDialog.tsx",
  "src/features/automation/AutomationManageDialog.tsx",
  "src/features/cloud/access-points/components/AccessPointManageDialog.tsx",
  "src/features/cloud/initialization/CloudPublishConfirmationDialog.tsx",
  "src/features/cloud/sections/access/CreateAccessDialog.tsx",
  "src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchCloseDialog.tsx",
] as const;

describe("global dialog overlay architecture", () => {
  it.each(FEATURE_OWNED_WINDOW_DIALOGS)("portals %s through the shared overlay layer", (path) => {
    const dialogSource = source(path);
    expect(dialogSource).toContain("<DesktopOverlayLayer>");
    expect(dialogSource).toContain("<DesktopDialogRoot");
  });

  it("keeps the shared backdrop fixed to the viewport and blurred", () => {
    const dialogStyles = source("src/styles/dialogs.css");
    expect(dialogStyles).toMatch(
      /\.desktop-dialog-backdrop\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*backdrop-filter:\s*blur\([^)]*\);/s,
    );
  });
});

function source(relativePath: string) {
  return readFileSync(new URL(`../../../../${relativePath}`, import.meta.url), "utf8");
}
