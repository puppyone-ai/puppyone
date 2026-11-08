/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeWithEntryFlow, type HomeWithEntryFlowProps } from "../../../support/react/homeWithEntryFlow";
import { withTestLocalization } from "../../../support/react/localization";
import { createTestSurfaceAppearance } from "../../../support/react/surfaceAppearance";
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
const target = (id: string) => document.querySelector<HTMLElement>(`[data-project-group="${id === "personal" ? "personal" : "team"}-shared"]`)!;
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
const localButton = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button[draggable=true]")]
  .find((button) => button.textContent?.includes(name))!;

describe("personal and organization destinations", () => {
  it("uses audience headings and omits an unused empty personal area", async () => {
    await render();
    expect([...document.querySelectorAll("[data-project-group]")].map((group) => group.getAttribute("data-project-group")))
      .toEqual(["team-shared", "local-only"]);
    expect(target("personal")).toBeNull();
    expect(target("team").textContent).toContain("Team Share Project");
    expect(target("team").textContent).toContain("Team project");
    expect(target("team").textContent).not.toContain("Draft");
  });
  it("orders team, personal and local areas, with nothing to focus in their headings", async () => {
    const host = await render({ projectItems: [...items, { id: "personal-project", label: "Personal notes", localPath: "",
      cloudProjectId: "personal-project", cloudOrganizationId: "personal" }] });
    const groups = [...host.querySelectorAll('[data-project-group]')];
    expect(groups.map((group) => group.getAttribute('data-project-group')))
      .toEqual(["team-shared", "personal-shared", "local-only"]);
    expect(groups.map((group) => group.querySelector('h2')?.textContent))
      .toEqual(["Team Share Project", "My Share Project", "On this computer"]);
    // The rule between groups is the heading's own edge (see the Homepage visual contract),
    // never an element of its own that assistive technology or the keyboard could reach.
    for (const group of groups) {
      const head = group.querySelector<HTMLElement>(".onboarding-project-group-head")!;
      expect(head.querySelector(".onboarding-project-group-divider, hr, [role=separator]")).toBeNull();
      expect([...head.querySelectorAll<HTMLElement>("[tabindex]")].filter((element) => element.tabIndex >= 0)).toEqual([]);
    }
  });
  it("does not replace a new account's empty start page with unused space placeholders", async () => {
    const host = await render({ projectItems: [] });
    expect(host.querySelector('[data-onboarding-state="empty"]')).not.toBeNull();
    expect(document.querySelector('[data-project-group="personal-shared"]')).toBeNull();
    expect(document.querySelector('[data-project-group="team-shared"]')).toBeNull();
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
    const card = localButton("Draft").closest(".onboarding-project-row-wrap")!;
    await act(async () => card.querySelector<HTMLButtonElement>(".onboarding-project-actions")!.click());
    const team = [...document.querySelectorAll<HTMLButtonElement>(".project-audience-tier")].find((row) => row.textContent?.includes("Team"))!;
    expect(team.textContent).toContain("Copy…");
    await act(async () => team.click());
    expect(publish).toHaveBeenCalledExactlyOnceWith("/fixture/draft", "team");
  });
  it("offers no copy for a folder that already has one, only a way to open it", async () => {
    const onOpenCloudProject = vi.fn();
    await render({ onRenameProject: async () => {}, onOpenCloudProject });
    const card = localButton("Existing").closest(".onboarding-project-row-wrap")!;
    await act(async () => card.querySelector<HTMLButtonElement>(".onboarding-project-actions")!.click());
    const team = [...document.querySelectorAll<HTMLButtonElement>(".project-audience-tier")].find((row) => row.textContent?.includes("Team"))!;
    expect(team.getAttribute("aria-checked")).toBe("true");
    expect(team.textContent).not.toContain("Copy…");
    const open = [...document.querySelectorAll<HTMLButtonElement>(".project-audience-detail")].find((row) => row.textContent?.includes("A copy in the cloud"))!;
    await act(async () => open.click());
    expect(onOpenCloudProject).toHaveBeenCalledExactlyOnceWith("remote");
    expect(publish).not.toHaveBeenCalled();
  });
  it("keeps an empty team one can add to there to drop into, with the same exact target", async () => {
    await render({ projectItems: [local], cloudSpaces: [spaces[1]] });
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
    expect(document.querySelector('[data-project-group="local-only"]')?.textContent).not.toContain("ditherit");
    expect([...document.querySelectorAll('button[draggable=true]')].filter((button) => button.textContent?.includes("ditherit"))).toHaveLength(1);
  });
  it("changes teams inside one area and keeps publication bound to the selected team", async () => {
    await render({ cloudSpaces: [...spaces, { id: "second", name: "Second team", kind: "team", canCreateProjects: true }] });
    await chooseTeam("second");
    expect(target("team").textContent).not.toContain("Team project");
    await drag(localButton("Draft"), "dragstart");
    await drag(target("team"), "drop");
    expect(publish).toHaveBeenCalledExactlyOnceWith("/fixture/draft", "second");
    expect(document.querySelectorAll('[data-project-group="team-shared"]')).toHaveLength(1);
  });
});
