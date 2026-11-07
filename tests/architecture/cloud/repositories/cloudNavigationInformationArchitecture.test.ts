import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLOUD_ROUTES, getCloudRoute, getCloudRouteWebPath, getCloudSignedOutSection, normalizeCloudSection }
  from "../../../../src/features/cloud/routes/cloudRoutes";
const source = (file: string) => readFileSync(new URL(`../../../../${file}`, import.meta.url), "utf8");

describe("Cloud Hub retirement", () => {
  it("removes the Hub, its sidebar and both Share onboarding presentations", () => {
    for (const file of ["CloudDialog.tsx", "CloudServiceSidebar.tsx", "CloudServiceMainView.tsx", "routes/CloudRouter.tsx",
      "routes/CloudProjectRouteOutlet.tsx", "organization/CloudOrganizationRouteOutlet.tsx", "share/ShareWizardDialog.tsx", "share/CloudShareHome.tsx", "share/useProjectShareActivity.ts",
      "share/CloudShareContext.tsx", "share/project-reach/ProjectReachDialog.tsx", "share/CloudWorkspaceShareDialog.tsx"]) {
      expect(existsSync(new URL(`../../../../src/features/cloud/${file}`, import.meta.url)), file).toBe(false);
    }
  });
  it("cannot revive Share from a preference or another local entry", () => {
    for (const file of ["src/App.tsx", "src/preferences.ts", "src/features/settings/main/ExperimentalSettingsView.tsx",
      "src/features/app-shell/DesktopTitlebarActions.tsx", "src/features/app-shell/project-place/ProjectPlaceMenu.tsx",
      "src/features/data-workspace/nodeActions.tsx"]) {
      expect(source(file), file).not.toMatch(/enableShareOnboarding|openShareWizard|onInvitePerson|onConnectAgent|onShare\??[:=,]/);
    }
    expect(source("src/features/cloud/workbench/CloudWorkspaceHeaderTools.tsx")).not.toMatch(/SHARE_WITH_PEOPLE|ShareDialog|getShareResource/);
  });
  it("retains service metadata and Web destinations without a navigation tree", () => {
    expect(CLOUD_ROUTES.every(route => !("showInSidebar" in route) && !("navigationGroup" in route))).toBe(true);
    expect(CLOUD_ROUTES.map(route => route.id)).not.toContain("share");
    expect(getCloudRouteWebPath("mcp", "p1")).toBe("/projects/p1/access");
    expect(getCloudRouteWebPath("cli", "p1")).toBe("/projects/p1/access");
    expect(getCloudRouteWebPath("cloud-team")).toBe("/team");
    expect(getCloudRouteWebPath("cloud-billing")).toBe("/billing");
    expect(getCloudRoute("history").surface).toBe("history");
    expect(() => getCloudRouteWebPath("access")).toThrow("project id");
  });
  it("keeps authentication on the publish task rather than an MCP invitation", () => {
    expect(getCloudSignedOutSection("initialize")).toBe("initialize");
    expect(normalizeCloudSection("share")).toBe("contents");
    expect(normalizeCloudSection("automation")).toBe("contents");
    expect(normalizeCloudSection("mcp-cli")).toBe("mcp");
  });
});
