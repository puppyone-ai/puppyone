/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspaceShareDialog } from "../../../../src/features/cloud/share/CloudWorkspaceShareDialog";
import { writeClipboardText } from "../../../../src/lib/clipboard";
import { withTestLocalization } from "../../../support/react/localization";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import type { CloudWorkspaceShareResource } from "../../../../src/features/cloud/share/cloudWorkspaceShareResource";

vi.mock("../../../../src/lib/cloudApi", () => ({
  getDesktopCloudWebUrl: () => "https://cloud-fixture.puppyone.ai/",
  cloudApiRequest: vi.fn().mockResolvedValue({ links: [], connections: [] }),
}));
vi.mock("../../../../src/lib/clipboard", () => ({ writeClipboardText: vi.fn().mockResolvedValue(undefined) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const projectId = "11111111-1111-4111-8111-111111111111";
let root: Root | null = null;
const invite = { session: { user_id: "alice" } as DesktopCloudSession, apiBaseUrl: "https://cloud-fixture.puppyone.ai/api/v1" };
async function render(scopePath?: string, resource?: CloudWorkspaceShareResource | null, agentInvite?: typeof invite) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const onClose = vi.fn();
  await act(async () => root!.render(withTestLocalization(<CloudWorkspaceShareDialog anchor={anchor()}
    context={{ status: "resolved", projectId, projectName: "Research", scopePath,
      target: scopePath ? { kind: "scope", project_id: projectId, scope_id: "limited" } : { kind: "project_root", project_id: projectId } }}
    resource={resource} agentInvite={agentInvite} onClose={onClose} />)));
  return onClose;
}
const anchor = () => { const button = document.createElement("button"); document.body.append(button); return { current: button }; };
const copy = () => document.querySelector<HTMLButtonElement>(".desktop-cloud-share-copy")!;
const address = () => document.querySelector<HTMLElement>("[data-share-target]")?.dataset.shareUrl;
const rows = () => [...document.querySelectorAll<HTMLElement>("[data-share-target]")];
const said = () => rows().map(row => [row.querySelector(".desktop-cloud-share-target-name")?.textContent,
  row.querySelector(".desktop-cloud-share-target-caption")?.textContent]);
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.clearAllMocks(); });

describe("Cloud workspace link sharing", () => {
  it("copies the configured website URL without requesting any API or granting access", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const close = await render();
    const url = `https://cloud-fixture.puppyone.ai/${projectId}/`;
    expect(address()).toBe(url);
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Share this project");
    expect(document.querySelector(".desktop-cloud-share-people p")?.textContent).toBe("Only people with access can open these links.");
    await act(async () => copy().click());
    expect(writeClipboardText).toHaveBeenCalledExactlyOnceWith(url);
    expect(copy().textContent).toBe("Copied");
    expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
    act(() => { document.querySelector('[role="dialog"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("keeps the address out of sight until the clipboard fails", async () => {
    await render();
    expect(document.querySelector("input")).toBeNull();
    expect(document.body.textContent).not.toContain(projectId);
  });
  it.each([
    [undefined, [["Research", "Whole project"]]],
    [{ path: "", directory: true }, [["Research", "Whole project"]]],
    [{ path: "Research/Notes", directory: true }, [["Notes", "This folder"], ["Research", "Whole project"]]],
    [{ path: "研究资料/Notes #1.md", directory: false, file: { name: "Notes #1.md", type: "markdown" as const } },
      [["Notes #1.md", "This file"], ["Research", "Whole project"]]],
  ])("says what each link opens, so a file's name never reads as an instruction", async (resource, expected) => {
    await render(undefined, resource);
    expect(said()).toEqual(expected);
  });
  it("calls an authorized folder a folder, because that is all this person can share", async () => {
    await render("Research/Limited");
    expect(said()).toEqual([["Limited", "This folder"]]);
  });
  it("has one way in for each kind of visitor, the Agent's first", async () => {
    await render(undefined, { path: "AGENTS.md", directory: false }, invite);
    expect([...document.querySelectorAll("h3")].map(node => node.textContent)).toEqual(["For agents", "For people"]);
    expect(document.querySelector(".desktop-cloud-agent-prompt")?.textContent).toContain('"Research"');
    expect(document.querySelectorAll(".desktop-cloud-workspace-share .po-button--primary")).toHaveLength(1);
  });
  it("offers only the link to someone who may not let an Agent in", async () => {
    await render(undefined, { path: "AGENTS.md", directory: false });
    expect([...document.querySelectorAll("h3")].map(node => node.textContent)).toEqual(["For people"]);
    expect(document.querySelector(".desktop-cloud-agent-prompt")).toBeNull();
    expect(document.querySelector(".desktop-cloud-workspace-share .po-button--primary")).toBeNull();
  });
  it("offers only the link in a scoped view, which an Agent cannot connect to", async () => {
    await render("Research", undefined, invite);
    expect(document.querySelector(".desktop-cloud-agent-prompt")).toBeNull();
  });
  it("copies the row that was pressed and says so only on that row", async () => {
    await render(undefined, { path: "AGENTS.md", directory: false });
    const [file, whole] = rows().map(row => row.querySelector<HTMLButtonElement>("button")!);
    expect(file.getAttribute("aria-label")).toBe("Copy link AGENTS.md");
    await act(async () => whole.click());
    expect(writeClipboardText).toHaveBeenCalledExactlyOnceWith(`https://cloud-fixture.puppyone.ai/${projectId}/`);
    expect([file.textContent, whole.textContent]).toEqual(["Copy link", "Copied"]);
  });
  it("preserves an authorized folder locator and encodes each path segment", async () => {
    await render("研究资料/Notes #1");
    await act(async () => copy().click());
    expect(writeClipboardText).toHaveBeenCalledWith(`https://cloud-fixture.puppyone.ai/${projectId}/%E7%A0%94%E7%A9%B6%E8%B5%84%E6%96%99/Notes%20%231/`);
  });
  it("copies the current nested file without fetching it", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await render(undefined, { path: "研究资料/Notes #1.md", directory: false, file: { name: "Notes #1.md", type: "markdown" } });
    await act(async () => copy().click());
    expect(writeClipboardText).toHaveBeenCalledWith(`https://cloud-fixture.puppyone.ai/${projectId}/%E7%A0%94%E7%A9%B6%E8%B5%84%E6%96%99/Notes%20%231.md`);
    expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
  });
  it("shares the selected directory as a directory", async () => {
    await render(undefined, { path: "Research", directory: true });
    expect(address()).toBe(`https://cloud-fixture.puppyone.ai/${projectId}/Research/`);
  });
  it.each([null, { path: "Other/secret.md", directory: false }])("does not widen scope or substitute a project URL for an unavailable resource", async resource => {
    await render("Research", resource);
    expect(address()).toBeUndefined();
    expect(copy()).toBeNull();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
  });
  it("hands over a selectable link when the clipboard fails, and supports retry", async () => {
    vi.mocked(writeClipboardText).mockRejectedValueOnce(new Error("denied"));
    await render(); await act(async () => copy().click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Couldn’t copy the link");
    expect(document.querySelector(".desktop-cloud-share-people")?.textContent).not.toContain("Only people with access");
    const field = document.querySelector("input");
    expect(field?.readOnly).toBe(true);
    expect(field?.value).toBe(`https://cloud-fixture.puppyone.ai/${projectId}/`);
    expect(field?.getAttribute("aria-label")).toBe("Link");
    await act(async () => copy().click());
    expect(document.querySelector('[role="alert"]')).toBeNull(); expect(copy().textContent).toBe("Copied");
    expect(document.querySelector(".desktop-cloud-share-people")?.textContent).toContain("Only people with access");
  });
});
