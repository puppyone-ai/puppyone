import { describe, expect, it, vi } from "vitest";
import { createSynchronizeApi } from "../../../../src/lib/cloud/synchronizeApi";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";

const session = { user_id: "user-1" } as DesktopCloudSession;

describe("canonical Synchronize resource transport", () => {
  it("lists actual bindings for an encoded project, never Access or Scope records", async () => {
    const request = vi.fn().mockResolvedValue([{ id: "binding-1", project_id: "project/a", path: "" }]);
    const api = createSynchronizeApi(request);
    expect(await api.listSynchronizeBindings(session, "project/a")).toEqual([{ id: "binding-1", project_id: "project/a", path: "" }]);
    expect(request).toHaveBeenCalledWith("/synchronize/bindings?project_id=project%2Fa", session, undefined, {}, undefined);
  });

  it("rejects cross-project lists and cross-binding run histories", async () => {
    const request = vi.fn().mockResolvedValueOnce([{ id: "binding", project_id: "other" }])
      .mockResolvedValueOnce([{ id: "run", synchronize_binding_id: "wrong-binding", status: "success" }]);
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

  it("reads canonical run references and rejects legacy responses without fallback", async () => {
    const runs = [{ id: "run", synchronize_binding_id: "binding/1", status: "failed" }];
    const request = vi.fn().mockResolvedValueOnce(runs)
      .mockResolvedValueOnce({ id: "run", access_point_id: "binding/1", status: "failed" });
    const api = createSynchronizeApi(request);
    expect(await api.listSynchronizeRuns(session, "binding/1")).toEqual(runs);
    expect(request.mock.calls[0][0]).toBe("/synchronize/bindings/binding%2F1/runs?limit=10");
    await expect(api.getSynchronizeRun(session, "run")).rejects.toThrow("missing its binding ID");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("creates a canonical binding and preserves arbitrary source metadata", async () => {
    const body = { project_id: "project", provider: "url", config: { source: { metadata: { connection_id: "custom" } } } };
    const result = { binding: { id: "binding", project_id: "project", path: "" },
      execution_result: { synchronize_binding_id: "binding", synchronize_run_id: "run", status: "queued" } };
    const request = vi.fn().mockResolvedValue(result);
    expect(await createSynchronizeApi(request).createSynchronizeBinding(session, body)).toEqual(result);
    expect(request).toHaveBeenCalledWith("/synchronize/bindings", session, undefined,
      { method: "POST", body: JSON.stringify(body) }, undefined);
  });

  it("rejects conflicting create identities and does not retry on the legacy API", async () => {
    const request = vi.fn().mockResolvedValue({ binding: { id: "binding", project_id: "wrong-project" } });
    await expect(createSynchronizeApi(request).createSynchronizeBinding(session,
      { project_id: "project", provider: "url", config: {} })).rejects.toThrow("inconsistent resource identities");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects missing paths, duplicate IDs and foreign management/history echoes", async () => {
    const binding = { id: "binding", project_id: "project", path: "" };
    const request = vi.fn(); const api = createSynchronizeApi(request);
    request.mockResolvedValue([{ ...binding, path: null }]);
    await expect(api.listSynchronizeBindings(session, "project")).rejects.toThrow("target path");
    request.mockResolvedValue([binding, binding]);
    await expect(api.listSynchronizeBindings(session, "project")).rejects.toThrow("duplicate");
    request.mockResolvedValue({ ...binding, id: "other" });
    await expect(api.updateSynchronizeBinding(session, "binding", {})).rejects.toThrow("identity");
    request.mockResolvedValue({ results: [{ synchronize_binding_id: "other" }] });
    await expect(api.refreshSynchronizeBinding(session, "binding")).rejects.toThrow("another binding");
    request.mockResolvedValue({ id: "other-run", synchronize_binding_id: "binding" });
    await expect(api.getSynchronizeRun(session, "run")).rejects.toThrow("another run");
    request.mockClear();
    await expect(api.listSynchronizeBindings(session, "")).rejects.toThrow("Project ID");
    await expect(api.getSynchronizeRun(session, "")).rejects.toThrow("run ID");
    expect(request).not.toHaveBeenCalled();
  });

  it("targets one binding for pause/resume/refresh/delete without resource lookup by name", async () => {
    const request = vi.fn().mockResolvedValue({ results: [{ synchronize_binding_id: "binding/1" }] });
    const api = createSynchronizeApi(request);
    await api.pauseSynchronizeBinding(session, "binding/1");
    await api.resumeSynchronizeBinding(session, "binding/1");
    await api.refreshSynchronizeBinding(session, "binding/1");
    await api.deleteSynchronizeBinding(session, "binding/1");
    expect(request.mock.calls.map(([path, , , init]) => [path, init.method])).toEqual([
      ["/synchronize/bindings/binding%2F1/pause", "POST"],
      ["/synchronize/bindings/binding%2F1/resume", "POST"],
      ["/synchronize/bindings/binding%2F1/refresh", "POST"],
      ["/synchronize/bindings/binding%2F1", "DELETE"],
    ]);
  });
});
