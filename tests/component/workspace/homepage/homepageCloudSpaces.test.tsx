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
  { id: "personal", name: "Alex", kind: "personal", canCreateProjects: true },
  { id: "team", name: "Design", kind: "team", canCreateProjects: true },
  { id: "read", name: "Guests", kind: "team", canCreateProjects: false },
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
    appearance={createTestSurfaceAppearance()} projectItems={items} cloudSpaces={spaces} cloudSpacesStatus="ready"
    onPublishToSpace={publish} onChooseWorkspace={async () => {}} onOpenWorkspacePath={async () => {}}
    onOpenDroppedWorkspace={async () => {}} {...overrides} />)));
  return host;
}
const GROUPS = { team: "Team Share Project", personal: "My space", local: "On this computer" } as const;
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
async function chooseTeam(id: string) {
  const select = document.querySelector<HTMLSelectElement>('[aria-label="Choose team"]')!;
  await act(async () => { select.value = id; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function drag(element: Element, type: string, data = { effectAllowed: "", dropEffect: "", setData: vi.fn(), getData: () => "/forged/path", files: [], types: ["text/plain"] }) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: data });
  await act(async () => element.dispatchEvent(event));
  return data;
}
const localButton = (name: string) => getByRole(document, "button", { name: `Open ${name} locally` });

describe("personal and organization destinations", () => {
  it("names a single team by its name and shows the plan each space is on", async () => {
    await render({
      cloudSpaces: [
        { id: "personal", name: "Alex", kind: "personal", canCreateProjects: true, planId: "personal" },
        { id: "team", name: "Design", kind: "team", canCreateProjects: true, planId: "team" },
      ],
      projectItems: [...items, { id: "personal-project", label: "Personal notes", localPath: "",
        cloudProjectId: "personal-project", cloudOrganizationId: "personal" }],
    });
    const names = queryAllByRole(document, "region").map(accessibleName);
    expect(names).toEqual(expect.arrayContaining(["Design", "My space"]));
    // Where a project lives says who pays for it.
    const plans = [...document.querySelectorAll(".onboarding-space-plan")].map((node) => node.textContent);
    expect(plans).toEqual(["Team", "Personal"]);
  });
  it("uses audience headings and omits an unused empty personal area", async () => {
    await render();
    expect(groupNames()).toEqual(["Team Share Project", "On this computer"]);
    expect(group("personal")).toBeNull();
    expect(target("team").textContent).toContain("Team Share Project");
    expect(target("team").textContent).toContain("Team project");
    expect(target("team").textContent).not.toContain("Draft");
  });
  it("orders team, personal and local areas, with nothing to focus in their headings", async () => {
    const host = await render({ projectItems: [...items, { id: "personal-project", label: "Personal notes", localPath: "",
      cloudProjectId: "personal-project", cloudOrganizationId: "personal" }] });
    expect(groupNames()).toEqual(["Team Share Project", "My space", "On this computer"]);
    // The rule between groups is the heading's own edge (see the Homepage visual contract),
    // never an element of its own that assistive technology or the keyboard could reach.
    for (const name of ["team", "personal", "local"] as const) {
      const heading = getByRole(group(name)!, "heading", { name: GROUPS[name] });
      expect(heading.tabIndex).toBeLessThan(0);
      expect(queryAllByRole(host, "separator")).toEqual([]);
      expect(host.querySelectorAll("hr")).toHaveLength(0);
    }
  });
  it("does not replace a new account's empty start page with unused space placeholders", async () => {
    vi.useFakeTimers();
    await render({ projectItems: [] });
    // The first run's page is announced once its intro has played.
    await act(async () => { vi.advanceTimersByTime(EMPTY_STATE_INTRO_FALLBACK_TIMEOUT_MS); });
    vi.useRealTimers();
    expect(getByRole(document, "heading", { name: "Start with your files. Agent-ready." })).toBeTruthy();
    expect(groupNames()).toEqual([]);
  });
  it("a trusted local drag chooses the exact destination, without publishing or removing files", async () => {
    await render();
    const data = await drag(localButton("Draft"), "dragstart");
    await drag(target("team"), "dragover", data);
    expect(data.dropEffect).toBe("copy");
    expect(target("team").getAttribute("data-drop-over")).toBe("true");
    await drag(target("team"), "drop", data);
    expect(publish).toHaveBeenCalledExactlyOnceWith("/fixture/draft", "team");
    expect(localButton("Draft")).toBeTruthy();
  });
  it("rejects a readonly destination and an already linked source", async () => {
    await render();
    await chooseTeam("read");
    await drag(localButton("Draft"), "dragstart");
    await drag(target("read"), "drop");
    await chooseTeam("team");
    await drag(localButton("Existing"), "dragstart");
    await drag(target("team"), "drop");
    expect(publish).not.toHaveBeenCalled();
  });
  it("does not accept a forged external path as an internal project drag", async () => {
    await render();
    await drag(target("team"), "drop");
    expect(publish).not.toHaveBeenCalled();
  });
  it("offers the same confirmed copy to a team from the project's own menu, for the keyboard", async () => {
    await render({ onRenameProject: async () => {} });
    const audience = await audienceOf("Draft");
    await act(async () => getByRole(audience, "menuitemcheckbox", { name: "Team Copy…", checked: false }).click());
    expect(publish).toHaveBeenCalledExactlyOnceWith("/fixture/draft", "team");
  });
  it("offers no copy for a folder that already has one, only a way to open it", async () => {
    const onOpenCloudProject = vi.fn();
    await render({ onRenameProject: async () => {}, onOpenCloudProject });
    const audience = await audienceOf("Existing");
    expect(rowsOf(audience)).toEqual([["Only this computer", false], ["Team", true], ["A copy in the cloud Open", null]]);
    await act(async () => getByRole(audience, "menuitem", { name: "A copy in the cloud Open" }).click());
    expect(onOpenCloudProject).toHaveBeenCalledExactlyOnceWith("remote");
    expect(publish).not.toHaveBeenCalled();
  });
  it("hangs a copy in the personal space under All my devices, and leaves Team unticked with nothing to copy", async () => {
    const onOpenCloudProject = vi.fn();
    await render({ onRenameProject: async () => {}, onOpenCloudProject, projectItems: [...items,
      { id: "mine", label: "Journal", localPath: "/fixture/journal", linkedCloudProject: { id: "mine-cloud", name: "Journal" } },
      { id: "mine-cloud", label: "Journal", localPath: "", cloudProjectId: "mine-cloud", cloudOrganizationId: "personal" }] });
    const audience = await audienceOf("Journal");
    expect(rowsOf(audience)).toEqual([
      ["Only this computer", false],
      ["All my devices", true],
      ["A copy in the cloud Open", null],
      ["Team", false],
    ]);
    await act(async () => getByRole(audience, "menuitem", { name: "A copy in the cloud Open" }).click());
    expect(onOpenCloudProject).toHaveBeenCalledExactlyOnceWith("mine-cloud");
    expect(publish).not.toHaveBeenCalled();
  });
  it("keeps an empty team one can add to there to drop into, with the same exact target", async () => {
    await render({ projectItems: [local], cloudSpaces: [spaces[1]] });
    const only = queryByRole(document, "region", { name: "Design" })!;
    // One team is its own heading.
    expect(only.textContent).toContain("Drag a project here to share it.");
    await drag(localButton("Draft"), "dragstart");
    await drag(only, "drop");
    expect(publish).toHaveBeenCalledExactlyOnceWith("/fixture/draft", "team");
  });
  it("still asks which team when there are several", async () => {
    await render({ projectItems: [local], cloudSpaces: [spaces[1], { id: "second", name: "Second team", kind: "team", canCreateProjects: true }] });
    expect(target("team").textContent).toContain("Team Share Project");
    expect(target("team").textContent).toContain("Drag a project here to share it.");
    await drag(localButton("Draft"), "dragstart");
    await drag(target("team"), "drop");
    expect(publish).toHaveBeenCalledExactlyOnceWith("/fixture/draft", "team");
  });
  it("never interprets a personal-area drop as a Cloud upload when device sharing is unavailable", async () => {
    await render({ projectItems: [...items, { id: "personal-project", label: "Personal notes", localPath: "",
      cloudProjectId: "personal-project", cloudOrganizationId: "personal" }] });
    await drag(localButton("Draft"), "dragstart");
    const data = await drag(target("personal"), "dragover");
    expect(data.dropEffect).toBe("none");
    await drag(target("personal"), "drop");
    expect(publish).not.toHaveBeenCalled();
  });
  it("puts a recorded shared local folder beside personal hosted projects without moving or duplicating it", async () => {
    await render({ projectItems: [local, { id: "ditherit", label: "ditherit", localPath: "/fixture/ditherit", hostFolderId: "shared-id" },
      { id: "personal-project", label: "Personal notes", localPath: "", cloudProjectId: "personal-project", cloudOrganizationId: "personal" }] });
    expect(target("personal").textContent).toContain("ditherit");
    expect(target("personal").textContent).toContain("Personal notes");
    expect(target("personal").textContent).not.toContain("Drop a project here");
    expect(group("local")?.textContent).not.toContain("ditherit");
    expect(queryAllByRole(document, "button", { name: /^Open ditherit/ })).toHaveLength(1);
  });
  it("changes teams inside one area and keeps publication bound to the selected team", async () => {
    await render({ cloudSpaces: [...spaces, { id: "second", name: "Second team", kind: "team", canCreateProjects: true }] });
    await chooseTeam("second");
    expect(target("team").textContent).not.toContain("Team project");
    await drag(localButton("Draft"), "dragstart");
    await drag(target("team"), "drop");
    expect(publish).toHaveBeenCalledExactlyOnceWith("/fixture/draft", "second");
    expect(groupNames().filter((name) => name === "Team Share Project")).toHaveLength(1);
  });
});
