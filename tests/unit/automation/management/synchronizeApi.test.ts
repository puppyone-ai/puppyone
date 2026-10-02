import { describe, expect, it, vi } from "vitest";
import { createSynchronizeApi } from "../../../../src/lib/cloud/synchronizeApi";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";

const session = { user_id: "user-1" } as DesktopCloudSession;

describe("Synchronize resource transport", () => {
  it("lists actual bindings for an encoded project, never Access or Scope records", async () => {
    const request = vi.fn().mockResolvedValue([{ id: "binding-1", project_id: "project/a" }]);
    const api = createSynchronizeApi(request);
    expect(await api.listSynchronizeBindings(session, "project/a")).toEqual([{ id: "binding-1", project_id: "project/a" }]);
    expect(request).toHaveBeenCalledWith("/integrations/connections?project_id=project%2Fa", session, undefined, {}, undefined);
  });

  it("rejects cross-project lists and cross-binding run histories", async () => {
    const request = vi.fn().mockResolvedValueOnce([{ id: "binding", project_id: "other" }])
      .mockResolvedValueOnce([{ id: "run", access_point_id: "wrong-binding", status: "success" }]);
    const api = createSynchronizeApi(request);
    await expect(api.listSynchronizeBindings(session, "project")).rejects.toThrow("another project");
    await expect(api.listSynchronizeRuns(session, "binding")).rejects.toThrow("another binding");
  });

  it("rejects missing binding IDs instead of manufacturing a resource identity", async () => {
    const request = vi.fn().mockResolvedValue([{ project_id: "project" }]);
    const api = createSynchronizeApi(request);
    await expect(api.listSynchronizeBindings(session, "project")).rejects.toThrow("invalid binding ID");
    expect(() => api.deleteSynchronizeBinding(session, "")).toThrow("binding ID is required");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("maps the legacy run reference only at the Synchronize HTTP boundary", async () => {
    const request = vi.fn().mockResolvedValue([{ id: "run", access_point_id: "binding/1", status: "failed" }]);
    const api = createSynchronizeApi(request);
    expect(await api.listSynchronizeRuns(session, "binding/1")).toEqual([
      { id: "run", synchronize_binding_id: "binding/1", status: "failed" },
    ]);
    expect(request.mock.calls[0][0]).toBe("/integrations/connections/binding%2F1/runs?limit=10");
  });

  it("targets the same binding for pause/resume/refresh/delete without any resource lookup by name", async () => {
    const request = vi.fn().mockResolvedValue({});
    const api = createSynchronizeApi(request);
    await api.pauseSynchronizeBinding(session, "binding/1");
    await api.resumeSynchronizeBinding(session, "binding/1");
    await api.refreshSynchronizeBinding(session, "binding/1");
    await api.deleteSynchronizeBinding(session, "binding/1");
    expect(request.mock.calls.map(([path, , , init]) => [path, init.method])).toEqual([
      ["/integrations/connections/binding%2F1/pause", "POST"],
      ["/integrations/connections/binding%2F1/resume", "POST"],
      ["/integrations/connections/binding%2F1/refresh", "POST"],
      ["/integrations/connections/binding%2F1", "DELETE"],
    ]);
  });
});
