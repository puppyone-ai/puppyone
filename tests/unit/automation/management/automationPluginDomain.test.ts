import { describe, expect, it } from "vitest";
import type { DesktopCloudConnector } from "../../../../src/lib/cloudApi";
import {
  buildCloudAutomationRows,
  getCloudAutomationWebPath,
  isCloudAutomationConnector,
} from "../../../../src/features/automation";
import {
  getCloudRoute,
  normalizeCloudSection,
} from "../../../../src/features/cloud/routes/cloudRoutes";

function connector(provider: string): DesktopCloudConnector {
  return {
    id: provider,
    target: { kind: "scope", project_id: "project-1", scope_id: "scope-1" },
    provider,
    name: provider,
    direction: "inbound",
    status: "active",
  };
}

describe("Automation and Plugin product-domain boundary", () => {
  it("classifies cloud information sources without capturing built-in access transports", () => {
    expect(isCloudAutomationConnector(connector("notion"))).toBe(true);
    expect(isCloudAutomationConnector(connector("google-drive"))).toBe(true);
    expect(isCloudAutomationConnector(connector("git_remote"))).toBe(false);
    expect(isCloudAutomationConnector(connector("mcp_endpoint"))).toBe(false);
    expect(isCloudAutomationConnector(connector("cli"))).toBe(false);
  });

  it("builds Automation-owned rows without adding them to the Access model", () => {
    const rows = buildCloudAutomationRows({
      scopes: [{
        id: "scope-1",
        target: { kind: "scope", project_id: "project-1", scope_id: "scope-1" },
        project_id: "project-1",
        name: "Docs",
        path: "docs",
        exclude: [],
        max_mode: "rw",
      }],
      connectors: [connector("notion"), connector("git_remote")],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "automation:scope-1:notion",
      connector: { provider: "notion" },
    });
  });

  it("uses Automation as the product route while preserving the established Cloud web path", () => {
    expect(getCloudRoute("automation").labelId).toBe("cloud.route.automation.label");
    expect(getCloudAutomationWebPath("project/a")).toBe("/projects/project%2Fa/workflows");
  });

  it("does not preserve retired route aliases in the production router", () => {
    expect(normalizeCloudSection("integrations")).toBe("contents");
  });
});
