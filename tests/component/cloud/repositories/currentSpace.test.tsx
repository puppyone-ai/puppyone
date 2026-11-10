/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { projectsInSpace, useCurrentSpace } from "../../../../src/features/cloud/spaces/useCurrentSpace";
import type { CloudSpace, ProjectHomeItem } from "../../../../src/lib/workspaceHomeModel";
import { readCachedSpaces } from "../../../../src/features/cloud/workbench/homepageCloudCatalogCache";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
let root: Root;
let value: ReturnType<typeof useCurrentSpace>;
function Harness({account = "user-1", projectId = null, available = spaces}: {
  account?: string | null; projectId?: string | null; available?: readonly CloudSpace[];
}) { value = useCurrentSpace({ account, projectId, spaces: available, items }); return null; }
beforeEach(() => { localStorage.clear(); root = createRoot(document.createElement("div")); });
afterEach(async () => { await act(async () => root.unmount()); });

it("keeps every local folder visible while scoping only cloud projects", () => {
  expect(projectsInSpace(items, "a").map((item) => item.id)).toEqual(["a1", "clone", "local"]);
  expect(projectsInSpace(items, "b").map((item) => item.id)).toEqual(["b1", "clone", "local"]);
  expect(projectsInSpace(items, null).map((item) => item.id)).toEqual(["clone", "local"]);
});
it("starts at the accessible default, then lets navigation choose another cloud Space", async () => {
  await act(async () => root.render(<Harness />));
  expect(value.id).toBe("a");
  await act(async () => value.select("b")); expect(value.id).toBe("b");
  await act(async () => value.select(null)); expect(value.id).toBe("a");
});
it("opening a project follows its owner and retains that selection after returning Home", async () => {
  await act(async () => root.render(<Harness projectId="pb" />)); expect(value.id).toBe("b");
  await act(async () => root.render(<Harness />)); expect(value.id).toBe("b");
});
it("does not carry a previous account's selection into a new account or signed-out window", async () => {
  await act(async () => root.render(<Harness />)); await act(async () => value.select("b"));
  await act(async () => root.render(<Harness account="user-2" />)); expect(value.id).toBe("a");
  await act(async () => root.render(<Harness account={null} available={[]} />)); expect(value.id).toBeNull();
});
it("falls back from a revoked stored Space without exposing its projects", async () => {
  await act(async () => root.render(<Harness />)); await act(async () => value.select("b"));
  await act(async () => root.render(<Harness available={[spaces[0]]} />));
  expect(value.id).toBe("a"); expect(value.items.map((item) => item.id)).toEqual(["a1", "clone", "local"]);
});
it("changing one window's Space does not change another already-open window", async () => {
  await act(async () => root.render(<Harness />));
  const first = value;
  const second = createRoot(document.createElement("div"));
  await act(async () => second.render(<Harness />));
  await act(async () => value.select("b"));
  expect(value.id).toBe("b"); expect(first.id).toBe("a");
  await act(async () => root.render(<Harness />));
  expect(value.id).toBe("a");
  await act(async () => second.unmount());
});

it("replaces the old local-mode preference with the default cloud Space without hiding local folders", async () => {
  localStorage.setItem("puppyone.current-space:user-1", "local");
  await act(async () => root.render(<Harness />));
  expect(value.id).toBe("a");
  expect(value.items.map(item => item.id)).toEqual(["a1", "clone", "local"]);
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

it("retains a newly created Space selection while discovery catches up", async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => value.select("new-space"));
  await act(async () => root.render(<Harness available={[...spaces,
    { id: "new-space", name: "New Space", kind: "space", canCreateProjects: true }]} />));
  expect(value.id).toBe("new-space");
});
