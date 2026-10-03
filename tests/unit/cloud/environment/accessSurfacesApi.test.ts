import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createAccessSurfacesApi, type AccessTransport } from "../../../../src/lib/cloud/accessSurfacesApi";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { accessSurfaceFixture } from "../../../support/cloud/accessSurfaceFixture";

const session: DesktopCloudSession = {
  user_id: "user-1", user_email: "user@example.test", api_base_url: "https://example.test/api/v1",
  session_generation: "generation-1", expires_in: 3600, expires_at: 0, status: "authenticated",
};

describe("canonical Access surface client", () => {
  it("preserves session transport context and uses encoded resource URLs", async () => {
    const row = accessSurfaceFixture({ id: "surface/1", project_id: "project/1", target: { kind: "project_root", project_id: "project/1" } });
    const request = vi.fn<AccessTransport>().mockResolvedValueOnce([row]).mockResolvedValue(row);
    const api = createAccessSurfacesApi(request as AccessTransport);
    const changed = vi.fn();
    const base = "https://other.example/api/v1";
    expect(await api.listAccessSurfaces(session, "project/1", changed, base)).toEqual([row]);
    expect(request).toHaveBeenLastCalledWith("/projects/project%2F1/access/surfaces", session, changed, { method: "GET" }, base);
    const patch = { config: { metadata: { connection_id: "user-owned", provider: "user label" } } };
    await api.updateAccessSurface(session, "project/1", row.id, patch, changed, base);
    expect(request).toHaveBeenLastCalledWith("/projects/project%2F1/access/surfaces/surface%2F1", session, changed, { method: "PATCH", body: JSON.stringify(patch) }, base);
    await api.pauseAccessSurface(session, "project/1", row.id);
    await api.resumeAccessSurface(session, "project/1", row.id);
    await api.deleteAccessSurface(session, "project/1", row.id);
    expect(request.mock.calls.slice(2).map(([path]) => path)).toEqual([
      "/projects/project%2F1/access/surfaces/surface%2F1/pause", "/projects/project%2F1/access/surfaces/surface%2F1/resume",
      "/projects/project%2F1/access/surfaces/surface%2F1",
    ]);
  });

  it.each([
    accessSurfaceFixture({ project_id: "foreign" }),
    accessSurfaceFixture({ kind: undefined, provider: "cli" } as never),
    accessSurfaceFixture({ target: { kind: "scope", project_id: "project-1", scope_id: "" } }),
    accessSurfaceFixture({ target: { kind: "project_root", project_id: "project-1", scope_id: "ambiguous" } } as never),
  ])("rejects old or foreign identities instead of converting them", async row => {
    const request = vi.fn<AccessTransport>().mockResolvedValue([row]);
    await expect(createAccessSurfacesApi(request as AccessTransport).listAccessSurfaces(session, "project-1")).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects mismatched creation, update, target and issuance echoes", async () => {
    const row = accessSurfaceFixture();
    const request = vi.fn<AccessTransport>().mockResolvedValueOnce([row, row])
      .mockResolvedValueOnce({ ...row, id: "another" })
      .mockResolvedValueOnce({ ...row, target: { kind: "scope", project_id: "project-1", scope_id: "other" } })
      .mockResolvedValueOnce({ access_surface_id: "another", credential: "secret" });
    const api = createAccessSurfacesApi(request as AccessTransport);
    await expect(api.listAccessSurfaces(session, "project-1")).rejects.toThrow("duplicate");
    await expect(api.updateAccessSurface(session, "project-1", row.id, { name: "Changed" })).rejects.toThrow("identity");
    await expect(api.createAccessSurface(session, "project-1", { target: row.target, kind: "cli", direction: "bidirectional" })).rejects.toThrow("another repository target");
    await expect(api.regenerateAccessSurfaceKey(session, row.id)).rejects.toThrow("inconsistent surface");
  });

  it("never broadens empty/legacy selectors or falls back after a backend error", async () => {
    const request = vi.fn<AccessTransport>(); const api = createAccessSurfacesApi(request as AccessTransport);
    await expect(api.listAccessSurfaces(session, "")).rejects.toThrow("explicit");
    await expect(api.listAccessibleSurfaces(session, { project_id: " " })).rejects.toThrow("empty");
    await expect(api.listAccessibleSurfaces(session, { provider: "cli" } as never)).rejects.toThrow("Unknown");
    expect(request).not.toHaveBeenCalled();
    request.mockRejectedValue(new Error("404 canonical backend required"));
    await expect(api.listAccessSurfaces(session, "project-1")).rejects.toThrow("404");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("removes legacy leaf resource aliases and has no Access run API", () => {
    const facade = readFileSync(new URL("../../../../src/lib/cloudApi.ts", import.meta.url), "utf8");
    expect(facade).not.toMatch(/DesktopCloudConnector|listCloudConnectors|updateCloudConnector|\/connectors\b/);
    const api = createAccessSurfacesApi(vi.fn<AccessTransport>() as AccessTransport);
    expect(Object.keys(api).some(name => /run|sync/i.test(name))).toBe(false);
  });
});
