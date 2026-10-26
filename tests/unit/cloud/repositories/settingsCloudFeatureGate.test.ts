import { describe, expect, it } from "vitest";
import {
  isSettingsSectionAvailable,
  resolveSettingsSidebarGroups,
} from "../../../../src/features/settings/sidebar/settingsSidebarModel";

describe("Settings Cloud feature gate", () => {
  it("keeps the account, and only the account, while the Desktop is local-first", () => {
    const context = { cloudEnabled: false, accountAvailable: true };
    const groups = resolveSettingsSidebarGroups(context);
    const sections = groups.flatMap((group) => group.items.map((item) => item.id));

    // An account is not Cloud: people buy compute on the website and use it
    // here with Cloud off. The Plan sells storage and the Cloud Computer.
    expect(groups.find((group) => group.id === "cloud")?.items.map((item) => item.id)).toEqual(["account"]);
    // The group is not called Cloud while Cloud is off.
    expect(groups.find((group) => group.id === "cloud")?.labelId).toBe("settings.sidebar.puppyone");
    expect(isSettingsSectionAvailable("account", context)).toBe(true);
    expect(isSettingsSectionAvailable("seats", context)).toBe(false);
    expect(sections).not.toContain("other-app-imports");
    // Where a project is hosted is a fact about the project, and GitHub is one
    // of the answers, so it survives our Cloud being switched off entirely.
    expect(sections).toContain("cloud");
    expect(isSettingsSectionAvailable("cloud", context)).toBe(true);
    expect(groups.find((group) => group.id === "local-project")?.items.map((item) => item.id))
      .toEqual(["local-project", "cloud", "git", "files"]);
    expect(sections).toContain("privacy");
    expect(isSettingsSectionAvailable("privacy", context)).toBe(true);
    expect(isSettingsSectionAvailable("experimental", context)).toBe(true);
    expect(groups.map((group) => group.id)).toEqual(["cloud", "desktop-app", "agents", "local-project"]);
    expect(groups.find((group) => group.id === "agents")?.items.map((item) => item.id)).toEqual(["local-agents", "model-connections"]);
    expect(isSettingsSectionAvailable("model-connections", context)).toBe(true);
  });

  it("shows no Account page in a build without PuppyOne accounts", () => {
    const context = { cloudEnabled: false, accountAvailable: false };
    expect(isSettingsSectionAvailable("account", context)).toBe(false);
    expect(resolveSettingsSidebarGroups(context).map((group) => group.id))
      .toEqual(["desktop-app", "agents", "local-project"]);
  });

  it("keeps the Cloud group to the account and what it runs once Puppyone Cloud is enabled", () => {
    const cloudGroup = resolveSettingsSidebarGroups({ cloudEnabled: true, accountAvailable: true })
      .find((group) => group.id === "cloud");

    // Identity, then what is held. Hosting moved to the project it describes,
    // and invoices are a browser surface that Seats links out to.
    expect(cloudGroup?.items.map((item) => item.id)).toEqual(["account", "seats"]);
    expect(cloudGroup?.labelId).toBe("settings.sidebar.cloud");
    expect(isSettingsSectionAvailable("account", { cloudEnabled: true, accountAvailable: true })).toBe(true);
    // Cloud leads once enabled: the nav scrolls, and an account below the fold
    // is an account nobody finds. See settingsSidebarModel.ts.
    expect(resolveSettingsSidebarGroups({ cloudEnabled: true, accountAvailable: true }).map((group) => group.id))
      .toEqual(["cloud", "desktop-app", "agents", "local-project"]);
    expect(isSettingsSectionAvailable("cloud", { cloudEnabled: true, accountAvailable: true })).toBe(true);
  });

  it("keeps app and account settings available in hosted-only workspaces", () => {
    const context = { cloudEnabled: true, accountAvailable: true, localWorkspaceAvailable: false };
    const sections = resolveSettingsSidebarGroups(context).flatMap(group => group.items.map(item => item.id));
    expect(sections).toContain("general");
    expect(sections).toContain("appearance");
    expect(sections).toContain("account");
    for (const section of ["local-project", "git", "files", "cloud"] as const) {
      expect(isSettingsSectionAvailable(section, context)).toBe(false);
      expect(sections).not.toContain(section);
    }
  });

  it("shows the import settings page only while the import experiment is enabled", () => {
    expect(isSettingsSectionAvailable("other-app-imports", {
      cloudEnabled: false,
      accountAvailable: true,
      otherAppImportsEnabled: false,
    })).toBe(false);
    expect(isSettingsSectionAvailable("other-app-imports", {
      cloudEnabled: false,
      accountAvailable: true,
      otherAppImportsEnabled: true,
    })).toBe(true);
  });
});
