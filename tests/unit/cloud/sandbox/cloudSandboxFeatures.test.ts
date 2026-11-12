import { describe, expect, it } from "vitest";
import { cloudSandboxContributions, readCloudSandbox } from "../../../../src/features/cloud/sandbox/cloudSandboxFeatures";

const desktop = (enabled: boolean) => readCloudSandbox({
  profile: "desktop",
  features: [
    { id: "desktop_screen", surface: "screen", enabled, reason: enabled ? null : "disabled" },
    { id: "browser", surface: null, enabled: true, reason: null },
    { id: "from_a_newer_server", surface: "panel", enabled: true, reason: null },
  ],
});

describe("Cloud sandbox Feature registry", () => {
  it("offers no entry points for base workspaces or servers before Profiles", () => {
    expect(cloudSandboxContributions(readCloudSandbox(undefined))).toEqual([]);
    expect(cloudSandboxContributions(readCloudSandbox({ profile: "base", features: [] }))).toEqual([]);
    expect(readCloudSandbox({ profile: 3, features: [{ id: 1 }, null] })).toEqual({ profile: null, features: [] });
  });

  it("places an enabled Feature in its slots and ignores Features it does not know", () => {
    const sandbox = desktop(true);
    expect(cloudSandboxContributions(sandbox).map(item => item.feature)).toEqual(["desktop_screen"]);
    expect(cloudSandboxContributions(sandbox, "sidebar-footer")).toHaveLength(1);
  });

  it("hides a Feature that policy disabled", () => {
    expect(cloudSandboxContributions(desktop(false))).toEqual([]);
  });
});
