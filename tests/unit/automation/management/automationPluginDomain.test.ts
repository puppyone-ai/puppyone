import { describe, expect, it } from "vitest";
import type { DesktopCloudSynchronizeBinding } from "../../../../src/lib/cloudApi";
import { buildCloudAutomationRows, getCloudAutomationWebPath } from "../../../../src/features/automation";
import { getCloudRoute, normalizeCloudSection } from "../../../../src/features/cloud/routes/cloudRoutes";

const binding: DesktopCloudSynchronizeBinding = {
  id: "binding-id", project_id: "project-1", provider: "url", direction: "inbound",
  status: "active", config: {}, path: "folder-without-scope",
};

describe("Automation resource identity", () => {
  it("renders a real binding without any Access surface or Scope", () => {
    expect(buildCloudAutomationRows({ projectId: "project-1", bindings: [binding] })).toEqual([{
      id: "synchronize:project-1:binding-id", resourceKind: "synchronize", binding,
    }]);
  });

  it("does not merge same-name bindings or cross project boundaries", () => {
    const rows = buildCloudAutomationRows({
      projectId: "project-1",
      bindings: [binding, { ...binding, id: "second-binding" }, { ...binding, project_id: "other-project" }],
    });
    expect(rows.map((row) => row.binding.id)).toEqual(["binding-id", "second-binding"]);
  });

  it("supports root destinations without manufacturing a root Scope", () => {
    const rows = buildCloudAutomationRows({ projectId: "project-1", bindings: [{ ...binding, path: "" }] });
    expect(rows[0].binding.path).toBe("");
    expect(rows[0]).not.toHaveProperty("scope");
    expect(rows[0]).not.toHaveProperty("connector");
  });

  it("preserves the Automation product route and established Cloud web path", () => {
    expect(getCloudRoute("automation").labelId).toBe("cloud.route.automation.label");
    expect(getCloudAutomationWebPath("project/a")).toBe("/projects/project%2Fa/workflows");
    expect(normalizeCloudSection("integrations")).toBe("contents");
  });
});
