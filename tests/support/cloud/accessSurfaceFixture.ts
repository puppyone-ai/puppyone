import type { DesktopCloudAccessSurface } from "../../../src/lib/cloudApi";

/** Complete canonical response, not a legacy provider/Scope surrogate. */
export function accessSurfaceFixture(overrides: Partial<DesktopCloudAccessSurface> = {}): DesktopCloudAccessSurface {
  const target = overrides.target ?? { kind: "project_root", project_id: "project-1" };
  return {
    id: "surface-1", project_id: target.project_id, target, kind: "cli", name: "Access",
    direction: "bidirectional", config: {}, policy: {}, oauth_connection_id: null,
    trigger: { type: "manual" }, status: "active", last_activity_at: null,
    error_message: null, created_by: null, created_at: null, updated_at: null,
    ...overrides,
  };
}
