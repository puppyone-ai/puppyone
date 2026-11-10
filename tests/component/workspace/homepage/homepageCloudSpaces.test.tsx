/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeWithEntryFlow, type HomeWithEntryFlowProps } from "../../../support/react/homeWithEntryFlow";
import { withTestLocalization } from "../../../support/react/localization";
import { accessibleName, getByRole, isChecked, queryAllByRole, queryByRole, roleOf } from "../../../support/react/queries";
import { createTestSurfaceAppearance } from "../../../support/react/surfaceAppearance";
import { EMPTY_STATE_INTRO_FALLBACK_TIMEOUT_MS } from "../../../../src/components/onboarding/emptyStateIntro";
import type { CloudSpace, ProjectHomeItem } from "../../../../src/lib/workspaceHomeModel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const spaces: CloudSpace[] = [
  { id: "personal", name: "Alex", kind: "space", canCreateProjects: true },
  { id: "team", name: "Design", kind: "space", canCreateProjects: true },
  { id: "read", name: "Guests", kind: "space", canCreateProjects: false },
];
const local: ProjectHomeItem = { id: "local", label: "Draft", localPath: "/fixture/draft" };
const items: ProjectHomeItem[] = [local,
  { id: "linked", label: "Existing", localPath: "/fixture/linked", linkedCloudProject: { id: "remote", name: "Remote" } },
  { id: "cloud", label: "Team project", localPath: "", cloudProjectId: "remote", cloudOrganizationId: "team" }];
let root: Root;
const publish = vi.fn(async () => {});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); publish.mockClear(); });
async function render(overrides: Partial<HomeWithEntryFlowProps> = {}) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(withTestLocalization(<HomeWithEntryFlow
    appearance={createTestSurfaceAppearance()} projectItems={items} cloudSpaces={[spaces[1]]} cloudSpacesStatus="ready"
    onPublishToSpace={publish} onChooseWorkspace={async () => {}} onOpenWorkspacePath={async () => {}}
    onOpenDroppedWorkspace={async () => {}} {...overrides} />)));
  return host;
}
const GROUPS = { team: "Design", personal: "Alex", local: "On this computer" } as const;
/** A group as it is announced: a region named by its heading. */
const group = (name: keyof typeof GROUPS) => queryByRole(document, "region", { name: GROUPS[name] });
const target = (id: string) => group(id === "personal" ? "personal" : "team")!;
const groupNames = () => queryAllByRole(document, "region").map(accessibleName).filter((name) => Object.values(GROUPS).includes(name as never));
/** Opens a project's ⋯ menu and returns who can open it, as announced. */
async function audienceOf(project: string) {
  await act(async () => getByRole(document, "button", { name: `Project actions for ${project}` }).click());
  return getByRole(document, "region", { name: "Who can open it" });
}
const rowsOf = (audience: HTMLElement) => [...audience.querySelectorAll("[role]")]
  .filter((row) => ["menuitemcheckbox", "menuitem"].includes(roleOf(row)!))
  .map((row) => [accessibleName(row), roleOf(row) === "menuitemcheckbox" ? isChecked(row) : null]);
async function drag(element: Element, type: string, data = { effectAllowed: "", dropEffect: "", setData: vi.fn(), getData: () => "/forged/path", files: [], types: ["text/plain"] }) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: data });
  await act(async () => element.dispatchEvent(event));
  return data;
}
const localButton = (name: string) => getByRole(document, "button", { name: `Open ${name} locally` });

describe("unified space destinations", () => {
  it("names the selected space and the plan its projects use", async () => {
    await render({cloudSpaces: [{...spaces[1], planId: "team_v2"}]});
    expect(target("team").textContent).toContain("Team project");
    expect(document.querySelector(".onboarding-space-plan")?.textContent).toBe("Team");
    expect(publish).not.toHaveBeenCalled();
  });
  it("uses the same presentation for a former personal space", async () => {
    await render({cloudSpaces: [spaces[0]], projectItems: [local, {
      id: "notes", label: "Notes", localPath: "", cloudProjectId: "notes", cloudOrganizationId: "personal",
    }]});
    expect(target("personal").textContent).toContain("Notes");
    await drag(localButton("Draft"), "dragstart");
    await drag(target("personal"), "drop");
    expect(publish).toHaveBeenCalledExactlyOnceWith("/fixture/draft", "personal");
  });
  it("binds a trusted local drag to the exact selected destination", async () => {
    await render();
    await drag(localButton("Draft"), "dragstart");
    await drag(target("team"), "drop");
    expect(publish).toHaveBeenCalledExactlyOnceWith("/fixture/draft", "team");
    expect(localButton("Draft")).toBeTruthy();
  });
  it("rejects a readonly destination", async () => {
    await render({cloudSpaces: [{...spaces[1], canCreateProjects: false}]});
    await drag(localButton("Draft"), "dragstart");
    await drag(target("team"), "drop");
    expect(publish).not.toHaveBeenCalled();
  });
  it("does not rebind a folder that already has a Cloud copy", async () => {
    await render();
    await drag(localButton("Existing"), "dragstart");
    await drag(target("team"), "drop");
    expect(publish).not.toHaveBeenCalled();
  });
  it("does not accept an external path as an internal project drag", async () => {
    await render();
    await drag(target("team"), "drop");
    expect(publish).not.toHaveBeenCalled();
  });
  it("offers the selected space through keyboard actions too", async () => {
    await render();
    const audience = await audienceOf("Draft");
    await act(async () => getByRole(audience, "menuitemcheckbox", { name: /^Space/ }).click());
    expect(publish).toHaveBeenCalledExactlyOnceWith("/fixture/draft", "team");
  });
  it("keeps unresolved ownership reachable without guessing a destination", async () => {
    await render({cloudSpaces: [], cloudSpacesStatus: "error"});
    expect(document.body.textContent).toContain("Team project");
    expect(document.querySelector(".onboarding-team-selector")).toBeNull();
    expect(publish).not.toHaveBeenCalled();
  });
});
