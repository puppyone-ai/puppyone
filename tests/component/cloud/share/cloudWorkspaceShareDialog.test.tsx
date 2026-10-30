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
async function render(scopePath?: string, previewEntries?: { name: string; type: string }[], resource?: CloudWorkspaceShareResource | null) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const onClose = vi.fn();
  await act(async () => root!.render(withTestLocalization(<CloudWorkspaceShareDialog
    context={{ status: "resolved", projectId, projectName: "Research", scopePath,
      target: scopePath ? { kind: "scope", project_id: projectId, scope_id: "limited" } : { kind: "project_root", project_id: projectId } }}
    resource={resource} previewEntries={previewEntries} onClose={onClose} />)));
  return onClose;
}
const copy = () => document.querySelector<HTMLButtonElement>(".desktop-cloud-share-copy")!;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.clearAllMocks(); });

describe("Cloud workspace link sharing", () => {
  it("copies the configured website URL without requesting any API or granting access", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const close = await render();
    const url = `https://cloud-fixture.puppyone.ai/${projectId}/`;
    expect(document.querySelector("input")?.value).toBe(url);
    expect(document.querySelector("h2")?.textContent).toBe("Share this project");
    expect(document.querySelector(".desktop-dialog-footer")).toBeNull();
    expect(document.querySelector(".desktop-cloud-share-preview-heading")).toBeNull();
    expect(document.body.textContent).not.toContain("Recipients use");
    expect(document.querySelector("input")?.getAttribute("aria-label")).toBe("Link");
    expect(copy().closest(".desktop-cloud-share-link")).toBe(document.querySelector("input")?.parentElement);
    await act(async () => copy().click());
    expect(writeClipboardText).toHaveBeenCalledExactlyOnceWith(url);
    expect(copy().getAttribute("aria-label")).toBe("Copied");
    expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("shows cached file names in the recipient preview without fetching their contents", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await render(undefined, [{ name: ".DS_Store", type: "file" }, { name: "Notes", type: "folder" }, { name: "Research.md", type: "markdown" }]);
    expect(document.querySelector('[data-explorer-path="puppyone-preview://share/Research.md"]')).not.toBeNull();
    expect(document.querySelector(".desktop-cloud-share-preview-window")?.hasAttribute("inert")).toBe(true);
    expect(document.querySelector(".desktop-cloud-share-preview-brand, .desktop-cloud-share-preview-paper")).toBeNull();
    expect(document.querySelector(".desktop-cloud-share-preview-window")?.textContent).toContain("Notes");
    expect(document.body.textContent).not.toContain(".DS_Store");
    expect(document.querySelector(".desktop-cloud-share-preview")?.querySelector(".desktop-cloud-share-preview-heading, .desktop-cloud-share-preview-brand")).toBeNull();
    expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
  });
  it("shows the address and the page it opens as one window, and says who can open it", async () => {
    await render(undefined, [{ name: "Research.md", type: "markdown" }]);
    const page = document.querySelector(".desktop-cloud-share-page")!;
    expect(page.querySelector("input")).not.toBeNull();
    expect(page.querySelector(".desktop-cloud-share-preview-window")).not.toBeNull();
    expect(document.querySelector(".desktop-cloud-share-people p")?.textContent).toContain("already have access");
  });
  it("names the two kinds of visitor only when both are offered", async () => {
    const heading = () => [...document.querySelectorAll("h3")].map(node => node.textContent);
    await render();
    expect(heading()).toEqual([]);
    act(() => root?.unmount());
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root!.render(withTestLocalization(<CloudWorkspaceShareDialog
      context={{ status: "resolved", projectId, projectName: "Research", target: { kind: "project_root", project_id: projectId } }}
      session={{ user_id: "alice" } as DesktopCloudSession} apiBaseUrl="https://cloud-fixture.puppyone.ai/api/v1" onClose={vi.fn()} />)));
    expect(heading()).toEqual(["Connect an agent", "Link for people"]);
  });
  it("preserves an authorized folder locator and encodes each path segment", async () => {
    await render("研究资料/Notes #1");
    await act(async () => copy().click());
    expect(writeClipboardText).toHaveBeenCalledWith(`https://cloud-fixture.puppyone.ai/${projectId}/%E7%A0%94%E7%A9%B6%E8%B5%84%E6%96%99/Notes%20%231/`);
  });
  it("copies the current nested file and selects the same file in its preview", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await render(undefined, undefined, { path: "研究资料/Notes #1.md", directory: false,
      entries: [{ name: "Unrelated.md", type: "markdown" }], file: { name: "Notes #1.md", type: "markdown" } });
    await act(async () => copy().click());
    expect(writeClipboardText).toHaveBeenCalledWith(`https://cloud-fixture.puppyone.ai/${projectId}/%E7%A0%94%E7%A9%B6%E8%B5%84%E6%96%99/Notes%20%231.md`);
    expect(document.querySelector('.tree-row.active')?.getAttribute("data-explorer-path")).toBe("puppyone-preview://share/Notes%20%231.md");
    expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
  });
  it("shares the selected directory without showing an unrelated document", async () => {
    await render(undefined, undefined, { path: "Research", directory: true, entries: [{ name: "Notes.md", type: "markdown" }] });
    expect(document.querySelector("input")?.value).toBe(`https://cloud-fixture.puppyone.ai/${projectId}/Research/`);
    expect(document.querySelector('.tree-row.active')).toBeNull();
  });
  it.each([null, { path: "Other/secret.md", directory: false }])("does not widen scope or substitute a project URL for an unavailable resource", async resource => {
    await render("Research", undefined, resource);
    expect(document.querySelector("input")).toBeNull();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
  });
  it("keeps the selectable link available on clipboard failure and supports retry", async () => {
    vi.mocked(writeClipboardText).mockRejectedValueOnce(new Error("denied"));
    await render(); await act(async () => copy().click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Couldn’t copy the link");
    expect(document.querySelector(".desktop-cloud-share-people")?.textContent).not.toContain("already have access");
    expect(document.querySelector("input")?.readOnly).toBe(true);
    await act(async () => copy().click());
    expect(document.querySelector('[role="alert"]')).toBeNull(); expect(copy().getAttribute("aria-label")).toBe("Copied");
    expect(document.querySelector(".desktop-cloud-share-people")?.textContent).toContain("already have access");
  });
});
