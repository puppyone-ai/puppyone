import { describe, expect, it, vi } from "vitest";
import { createResourceDashboardApi, validateResourceDashboard, type DashboardTransport, type DesktopCloudDashboard } from "../../../../src/lib/cloud/resourceDashboardApi";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";

const data: DesktopCloudDashboard = {
  project: { id: "project/1", name: "Project" }, nodes: { total: 0, files: 0, folders: 0 }, tools: [], uploads: [],
  resources: [
    { resource_kind: "synchronize", resource_id: "same", project_id: "project/1", provider: "url", path: "", status: "active" },
    { resource_kind: "access", resource_id: "same", project_id: "project/1", kind: "mcp", target: { kind: "project_root", project_id: "project/1" }, status: "paused" },
  ],
};

describe("canonical Dashboard resources", () => {
  it("preserves domain identities and session/server transport without legacy fallback", async () => {
    const request = vi.fn<DashboardTransport>().mockResolvedValue(data);
    const api = createResourceDashboardApi(request as DashboardTransport);
    const session = { user_id: "user-1", session_generation: "session-1" } as DesktopCloudSession;
    const changed = vi.fn();
    expect(await api.getResourceDashboard(session, "project/1", changed, "https://backend.example/api/v1")).toEqual(data);
    expect(request).toHaveBeenCalledWith("/projects/project%2F1/dashboard/resources", session, changed, {}, "https://backend.example/api/v1");
    request.mockRejectedValue(new Error("backend upgrade required"));
    await expect(api.getResourceDashboard(session, "project/1")).rejects.toThrow("upgrade");
    expect(request).toHaveBeenCalledTimes(2);
    await expect(api.getResourceDashboard(session, " ")).rejects.toThrow("explicit");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rejects ambiguous, foreign and duplicate identities rather than interpreting aliases", () => {
    expect(() => validateResourceDashboard({ ...data, resources: [data.resources[0], data.resources[0]] }, "project/1")).toThrow("duplicate");
    for (const row of [
      { ...data.resources[0], project_id: "foreign" },
      { ...data.resources[0], resource_kind: "connection" },
      { ...data.resources[0], access_key: "not-a-credential-endpoint" },
      { ...data.resources[1], target: { kind: "project_root", project_id: "project/1", scope_id: "ambiguous" } },
      { ...data.resources[1], target: { kind: "scope", project_id: "foreign", scope_id: "scope-1" } },
    ]) expect(() => validateResourceDashboard({ ...data, resources: [row] } as DesktopCloudDashboard, "project/1")).toThrow();
    expect(() => validateResourceDashboard({ ...data, resources: undefined, connections: [] } as unknown as DesktopCloudDashboard, "project/1")).toThrow("inventory");
  });
});
