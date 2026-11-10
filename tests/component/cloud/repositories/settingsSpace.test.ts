/** @vitest-environment happy-dom */
import { beforeEach, expect, it } from "vitest";
import { resolveProjectSpaceId, resolveSettingsSpace } from "../../../../src/features/cloud/spaces/resolveSettingsSpace";
import type { CloudSpace, ProjectHomeItem } from "../../../../src/lib/workspaceHomeModel";
import { readCachedSpaces } from "../../../../src/features/cloud/workbench/homepageCloudCatalogCache";
const spaces: CloudSpace[] = [
  { id: "a", name: "A", kind: "space", isDefault: true, canCreateProjects: true },
  { id: "b", name: "B", kind: "space", canCreateProjects: true },
];
const items: ProjectHomeItem[] = [
  { id: "a1", label: "A project", localPath: "", cloudProjectId: "pa", cloudOrganizationId: "a" },
  { id: "b1", label: "B project", localPath: "", cloudProjectId: "pb", cloudOrganizationId: "b" },
  { id: "clone", label: "B local copy", localPath: "/b", linkedCloudProject: { id: "pb", name: "B project" } },
  { id: "local", label: "Local", localPath: "/local" },
];
beforeEach(() => localStorage.clear());
it("suggests the open cloud project's Space only for management", () => {
  expect(resolveSettingsSpace({ account: "user", spaces, projectId: "pb", items })?.id).toBe("b");
  expect(resolveSettingsSpace({ account: "user", spaces, projectId: null, items })?.id).toBe("a");
  expect(items.map(item => item.id)).toEqual(["a1", "b1", "clone", "local"]);
});
it("manages the Space its opener named, and only an accessible one", () => {
  expect(resolveSettingsSpace({ account: "user", spaces, projectId: "pa", items, requestedId: "b" })?.id).toBe("b");
  expect(resolveSettingsSpace({ account: "user", spaces, projectId: "pb", items, requestedId: "gone" })?.id).toBe("b");
  expect(resolveSettingsSpace({ account: null, spaces, projectId: null, items, requestedId: "b" })).toBeNull();
});
it("names the open Cloud project's Space only once the account lists it", () => {
  expect(resolveProjectSpaceId({ spaces, projectId: "pb", items })).toBe("b");
  expect(resolveProjectSpaceId({ spaces: [spaces[0]], projectId: "pb", items })).toBeNull();
  expect(resolveProjectSpaceId({ spaces, projectId: null, items })).toBeNull();
});
it("ignores retired global selections and only chooses accessible Spaces", () => {
  localStorage.setItem("puppyone.current-space:user", "b");
  expect(resolveSettingsSpace({ account: "user", spaces, projectId: null, items })?.id).toBe("a");
  expect(resolveSettingsSpace({ account: "user", spaces: [spaces[0]], projectId: "pb", items })?.id).toBe("a");
  expect(resolveSettingsSpace({ account: null, spaces, projectId: "pb", items })).toBeNull();
});
it("normalizes cached legacy Space kinds and keeps them isolated to their account", () => {
  localStorage.setItem("puppyone.desktop.cloud-spaces.v1", JSON.stringify({ scope: "account-a", spaces: [
    { ...spaces[0], kind: "personal", canManageSpace: true },
    { ...spaces[1], kind: "team", canManageSpace: false },
  ] }));
  const restored = readCachedSpaces("account-a")!;
  expect(restored.map(space => space.kind)).toEqual(["space", "space"]);
  expect(restored.map(space => space.id)).toEqual(["a", "b"]);
  expect(restored.map(space => space.canManageSpace)).toEqual([true, false]);
  expect(readCachedSpaces("account-b")).toBeUndefined();
});
