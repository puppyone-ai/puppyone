/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspaceShareDialog } from "../../../../src/features/cloud/share/CloudWorkspaceShareDialog";
import { writeClipboardText } from "../../../../src/lib/clipboard";
import { withTestLocalization } from "../../../support/react/localization";
import type { CloudWorkspaceShareResource } from "../../../../src/features/cloud/share/cloudWorkspaceShareResource";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";

vi.mock("../../../../src/lib/cloudApi", () => ({
  getDesktopCloudWebUrl: () => "https://cloud-fixture.puppyone.ai/",
  cloudApiRequest: vi.fn().mockResolvedValue({ links: [], connections: [] }),
}));
vi.mock("../../../../src/lib/clipboard", () => ({ writeClipboardText: vi.fn().mockResolvedValue(undefined) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const projectId = "11111111-1111-4111-8111-111111111111";
let root: Root | null = null;
async function render(scopePath?: string, resource?: CloudWorkspaceShareResource | null) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const onClose = vi.fn();
  await act(async () => root!.render(withTestLocalization(<CloudWorkspaceShareDialog anchor={anchor()}
    context={{ status: "resolved", projectId, projectName: "Research", scopePath,
      target: scopePath ? { kind: "scope", project_id: projectId, scope_id: "limited" } : { kind: "project_root", project_id: projectId } }}
    resource={resource} onClose={onClose} />)));
  return onClose;
}
const anchor = () => { const button = document.createElement("button"); document.body.append(button); return { current: button }; };
const copy = () => document.querySelector<HTMLButtonElement>(".desktop-cloud-share-copy")!;
const address = () => document.querySelector<HTMLElement>(".desktop-cloud-share-people")?.dataset.shareUrl;
const heading = () => [...document.querySelectorAll("h3")].map(node => node.textContent);
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.clearAllMocks(); });

describe("Cloud workspace link sharing", () => {
  it("copies the configured website URL without requesting any API or granting access", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const close = await render();
    const url = `https://cloud-fixture.puppyone.ai/${projectId}/`;
    expect(address()).toBe(url);
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Share this project");
    expect(document.querySelector(".desktop-cloud-share-people p")?.textContent).toBe("Only people with access can open it.");
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
    [undefined, "Link to Research"],
    [{ path: "Research/Notes", directory: true }, "Link to Notes"],
    [{ path: "研究资料/Notes #1.md", directory: false, file: { name: "Notes #1.md", type: "markdown" as const } }, "Link to Notes #1.md"],
  ])("says what the link opens by name", async (resource, title) => {
    await render(undefined, resource);
    expect(heading()).toEqual([title]);
  });
  it("offers the two kinds of visitor in the same shape", async () => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root!.render(withTestLocalization(<CloudWorkspaceShareDialog anchor={anchor()}
      context={{ status: "resolved", projectId, projectName: "Research", target: { kind: "project_root", project_id: projectId } }}
      session={{ user_id: "alice" } as DesktopCloudSession} apiBaseUrl="https://cloud-fixture.puppyone.ai/api/v1" onClose={vi.fn()} />)));
    expect(heading()).toEqual(["Connect an agent", "Link to Research"]);
    expect(document.querySelectorAll(".desktop-cloud-share-offer")).toHaveLength(2);
    expect(document.querySelectorAll(".desktop-cloud-workspace-share button.primary")).toHaveLength(1);
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
