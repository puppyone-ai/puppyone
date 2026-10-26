import { describe, expect, it } from "vitest";
import {
  isSettingsSectionAvailable,
  resolveSettingsSidebarGroups,
} from "../../../../src/features/settings/sidebar/settingsSidebarModel";

describe("Settings Cloud feature gate", () => {
  it("shows no Account or Cloud page while the Desktop is local-first", () => {
    const groups = resolveSettingsSidebarGroups({ cloudEnabled: false });
    const sections = groups.flatMap((group) => group.items.map((item) => item.id));

    // Signing in only serves Cloud, so Account and Plan wait for the experiment.
    expect(sections).not.toContain("account");
    expect(sections).not.toContain("seats");
    expect(sections).not.toContain("other-app-imports");
    expect(groups.find((group) => group.id === "cloud")).toBeUndefined();
    expect(isSettingsSectionAvailable("account", { cloudEnabled: false })).toBe(false);
    expect(isSettingsSectionAvailable("seats", { cloudEnabled: false })).toBe(false);
    // Where a project is hosted is a fact about the project, and GitHub is one
    // of the answers, so it survives our Cloud being switched off entirely.
    expect(sections).toContain("cloud");
    expect(isSettingsSectionAvailable("cloud", { cloudEnabled: false })).toBe(true);
    expect(groups.find((group) => group.id === "local-project")?.items.map((item) => item.id))
      .toEqual(["local-project", "cloud", "git", "files"]);
    expect(sections).toContain("privacy");
    expect(isSettingsSectionAvailable("privacy", { cloudEnabled: false })).toBe(true);
    expect(isSettingsSectionAvailable("experimental", { cloudEnabled: false })).toBe(true);
    expect(groups.map((group) => group.id)).toEqual(["desktop-app", "agents", "local-project"]);
    expect(groups.find((group) => group.id === "agents")?.items.map((item) => item.id)).toEqual(["local-agents", "model-connections"]);
    expect(isSettingsSectionAvailable("model-connections", { cloudEnabled: false })).toBe(true);
  });

  it("keeps the Cloud group to the account and what it runs once Puppyone Cloud is enabled", () => {
    const cloudGroup = resolveSettingsSidebarGroups({ cloudEnabled: true })
      .find((group) => group.id === "cloud");

    // Identity, then what is held. Hosting moved to the project it describes,
    // and invoices are a browser surface that Seats links out to.
    expect(cloudGroup?.items.map((item) => item.id)).toEqual(["account", "seats"]);
    expect(isSettingsSectionAvailable("account", { cloudEnabled: true })).toBe(true);
    // Cloud leads once enabled: the nav scrolls, and an account below the fold
    // is an account nobody finds. See settingsSidebarModel.ts.
    expect(resolveSettingsSidebarGroups({ cloudEnabled: true }).map((group) => group.id))
      .toEqual(["cloud", "desktop-app", "agents", "local-project"]);
    expect(isSettingsSectionAvailable("cloud", { cloudEnabled: true })).toBe(true);
  });

  it("keeps app and account settings available in hosted-only workspaces", () => {
    const context = { cloudEnabled: true, localWorkspaceAvailable: false };
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
      otherAppImportsEnabled: false,
    })).toBe(false);
    expect(isSettingsSectionAvailable("other-app-imports", {
      cloudEnabled: false,
      otherAppImportsEnabled: true,
    })).toBe(true);
  });
});
