/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspaceShareDialog } from "../../../../src/features/cloud/share/CloudWorkspaceShareDialog";
import { writeClipboardText } from "../../../../src/lib/clipboard";
import { withTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/lib/cloudApi", () => ({ getDesktopCloudWebUrl: () => "https://cloud-fixture.puppyone.ai/" }));
vi.mock("../../../../src/lib/clipboard", () => ({ writeClipboardText: vi.fn().mockResolvedValue(undefined) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const projectId = "11111111-1111-4111-8111-111111111111";
let root: Root | null = null;
async function render(scopePath?: string) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const onClose = vi.fn();
  await act(async () => root!.render(withTestLocalization(<CloudWorkspaceShareDialog
    context={{ status: "resolved", projectId, projectName: "Research", scopePath,
      target: scopePath ? { kind: "scope", project_id: projectId, scope_id: "limited" } : { kind: "project_root", project_id: projectId } }}
    onClose={onClose} />)));
  return onClose;
}
const copy = () => document.querySelector<HTMLButtonElement>(".desktop-dialog-button.primary")!;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.clearAllMocks(); });

describe("Cloud workspace link sharing", () => {
  it("copies the configured website URL without requesting any API or granting access", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const close = await render();
    const url = `https://cloud-fixture.puppyone.ai/${projectId}/`;
    expect(document.querySelector("input")?.value).toBe(url);
    expect(document.body.textContent).toContain("Recipients use their existing workspace permissions.");
    await act(async () => copy().click());
    expect(writeClipboardText).toHaveBeenCalledExactlyOnceWith(url);
    expect(copy().textContent).toContain("Copied");
    expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("preserves an authorized folder locator and encodes each path segment", async () => {
    await render("研究资料/Notes #1");
    await act(async () => copy().click());
    expect(writeClipboardText).toHaveBeenCalledWith(`https://cloud-fixture.puppyone.ai/${projectId}/%E7%A0%94%E7%A9%B6%E8%B5%84%E6%96%99/Notes%20%231/`);
  });
  it("keeps the selectable link available on clipboard failure and supports retry", async () => {
    vi.mocked(writeClipboardText).mockRejectedValueOnce(new Error("denied"));
    await render(); await act(async () => copy().click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Couldn’t copy the link");
    expect(document.querySelector("input")?.readOnly).toBe(true);
    await act(async () => copy().click());
    expect(document.querySelector('[role="alert"]')).toBeNull(); expect(copy().textContent).toContain("Copied");
  });
});
