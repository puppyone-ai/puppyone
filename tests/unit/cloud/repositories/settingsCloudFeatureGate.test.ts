import { describe, expect, it } from "vitest";
import {
  isSettingsSectionAvailable,
  resolveSettingsSidebarGroups,
} from "../../../../src/features/settings/sidebar/settingsSidebarModel";

describe("Settings Cloud feature gate", () => {
  it("keeps Account public while Cloud hosting remains experimental", () => {
    const groups = resolveSettingsSidebarGroups({ cloudEnabled: false });
    const sections = groups.flatMap((group) => group.items.map((item) => item.id));

    const cloudGroup = groups.find((group) => group.id === "cloud");
    expect(sections).toContain("account");
    expect(sections).not.toContain("cloud");
    expect(cloudGroup?.items.map((item) => item.id)).toEqual(["account"]);
    expect(isSettingsSectionAvailable("account", { cloudEnabled: false })).toBe(true);
    expect(isSettingsSectionAvailable("cloud", { cloudEnabled: false })).toBe(false);
    expect(sections).toContain("privacy");
    expect(isSettingsSectionAvailable("privacy", { cloudEnabled: false })).toBe(true);
    expect(isSettingsSectionAvailable("experimental", { cloudEnabled: false })).toBe(true);
    expect(groups.map((group) => group.id)).toEqual(["desktop-app", "agents", "local-project", "cloud"]);
    expect(groups.find((group) => group.id === "agents")?.items.map((item) => item.id)).toEqual(["local-agents", "model-connections"]);
    expect(isSettingsSectionAvailable("model-connections", { cloudEnabled: false })).toBe(true);
  });

  it("reveals the complete Cloud settings group after PuppyOne Cloud is enabled", () => {
    const cloudGroup = resolveSettingsSidebarGroups({ cloudEnabled: true })
      .find((group) => group.id === "cloud");

    expect(cloudGroup?.items.map((item) => item.id)).toEqual(["account", "cloud"]);
    expect(isSettingsSectionAvailable("account", { cloudEnabled: true })).toBe(true);
    expect(isSettingsSectionAvailable("cloud", { cloudEnabled: true })).toBe(true);
  });
});
