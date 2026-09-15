import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sidebarSource = readFileSync(
  new URL("../../../../src/features/cloud/CloudServiceSidebar.tsx", import.meta.url),
  "utf8",
);
const sidebarCss = readFileSync(
  new URL("../../../../src/features/cloud/styles/sidebar-shell.css", import.meta.url),
  "utf8",
);
const workspaceSurfaceSource = readFileSync(
  new URL("../../../../src/features/app-shell/workspace-surfaces/useWorkspaceSurfaceContent.tsx", import.meta.url),
  "utf8",
);

describe("Cloud account ownership", () => {
  it("does not duplicate the application account inside the Cloud sidebar", () => {
    expect(sidebarSource).not.toContain("desktop-cloud-sidebar-account");
    expect(sidebarSource).not.toContain("desktop-cloud-sidebar-footer");
    expect(sidebarSource).not.toContain("onOpenAccount");
    expect(sidebarSource).not.toContain("formatSidebarAccount");
  });

  it("keeps Account Settings owned by the global Settings surface", () => {
    expect(workspaceSurfaceSource).not.toContain("onOpenAccount");
    expect(workspaceSurfaceSource).not.toContain('onSelectSettingsSection("account")');
  });

  it("removes the obsolete footer styling instead of leaving dormant CSS", () => {
    expect(sidebarCss).not.toContain(".desktop-cloud-sidebar-account");
    expect(sidebarCss).not.toContain(".desktop-cloud-sidebar-footer");
  });
});
