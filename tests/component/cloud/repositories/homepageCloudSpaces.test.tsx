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
const target = (id: string) => document.querySelector<HTMLElement>(`[data-project-group="cloud-space:${id}"]`)!;
async function drag(element: Element, type: string, data = { effectAllowed: "", dropEffect: "", setData: vi.fn(), getData: () => "/forged/path", files: [], types: ["text/plain"] }) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: data });
  await act(async () => element.dispatchEvent(event));
  return data;
}
const localButton = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button[draggable=true]")]
  .find((button) => button.textContent?.includes(name))!;

describe("personal and organization destinations", () => {
  it("keeps empty spaces and separates their projects from local sources", async () => {
    await render();
    expect([...document.querySelectorAll("[data-project-group]")].map((group) => group.getAttribute("data-project-group")))
      .toEqual(["cloud-space:personal", "cloud-space:team", "cloud-space:read", "this-computer"]);
    expect(target("personal").textContent).toContain("Personal Cloud");
    expect(target("team").textContent).toContain("Team project");
    expect(target("team").textContent).not.toContain("Draft");
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
    await drag(localButton("Draft"), "dragstart");
    await drag(target("read"), "drop");
    await drag(localButton("Existing"), "dragstart");
    await drag(target("team"), "drop");
    expect(publish).not.toHaveBeenCalled();
  });
  it("does not accept a forged external path as an internal project drag", async () => {
    await render();
    await drag(target("team"), "drop");
    expect(publish).not.toHaveBeenCalled();
  });
  it("offers the same confirmed flow through the accessible group menu", async () => {
    await render();
    await act(async () => target("personal").querySelector<HTMLButtonElement>("button")!.click());
    const entry = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent?.includes("Draft"));
    expect(entry).toBeTruthy();
    expect(document.activeElement).toBe(entry);
    await act(async () => entry!.click());
    expect(publish).toHaveBeenCalledExactlyOnceWith("/fixture/draft", "personal");
  });
  it("shows a single empty personal space with its identity instead of dropping the heading", async () => {
    await render({ projectItems: [], cloudSpaces: [spaces[0]] });
    expect(target("personal").textContent).toContain("Alex");
  });
});
