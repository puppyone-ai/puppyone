import { describe, expect, it } from "vitest";
import {
  isSettingsSectionAvailable,
  resolveSettingsSidebarGroups,
} from "../../../../src/features/settings/sidebar/settingsSidebarModel";

describe("Settings Cloud feature gate", () => {
  it("hides every Cloud settings destination until PuppyOne Cloud is enabled", () => {
    const groups = resolveSettingsSidebarGroups({ cloudEnabled: false });
    const sections = groups.flatMap((group) => group.items.map((item) => item.id));

    expect(groups.map((group) => group.id)).not.toContain("cloud");
    expect(sections).not.toContain("account");
    expect(sections).not.toContain("cloud");
    expect(isSettingsSectionAvailable("account", { cloudEnabled: false })).toBe(false);
    expect(isSettingsSectionAvailable("cloud", { cloudEnabled: false })).toBe(false);
    expect(sections).toContain("privacy");
    expect(isSettingsSectionAvailable("privacy", { cloudEnabled: false })).toBe(true);
    expect(isSettingsSectionAvailable("experimental", { cloudEnabled: false })).toBe(true);
  });

  it("reveals the complete Cloud settings group after PuppyOne Cloud is enabled", () => {
    const cloudGroup = resolveSettingsSidebarGroups({ cloudEnabled: true })
      .find((group) => group.id === "cloud");

    expect(cloudGroup?.items.map((item) => item.id)).toEqual(["account", "cloud"]);
    expect(isSettingsSectionAvailable("account", { cloudEnabled: true })).toBe(true);
    expect(isSettingsSectionAvailable("cloud", { cloudEnabled: true })).toBe(true);
  });
});
