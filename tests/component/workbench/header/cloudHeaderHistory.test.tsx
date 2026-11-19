/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspaceHeaderTools } from "../../../../src/features/cloud/workbench/CloudWorkspaceHeaderTools";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tool = () => document.querySelector<HTMLButtonElement>('[data-cloud-workspace-tool="history"]');
let root: Root;
const render = (onOpenHistory?: () => void) => act(async () => root.render(withTestLocalization(
  <CloudWorkspaceHeaderTools context={null} session={null} apiBaseUrl="https://cloud.fixture"
    onSessionChange={vi.fn()} onOpenHistory={onOpenHistory} />)));
beforeEach(() => { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); });

describe("History among a Cloud project's Header tools", () => {
  it("is offered where the project has a record", async () => {
    const onOpenHistory = vi.fn();
    await render(onOpenHistory);
    expect(tool()?.getAttribute("aria-label")).toBe("History");
    await act(async () => tool()!.click());
    expect(onOpenHistory).toHaveBeenCalledOnce();
  });
  it("is absent where there is nothing to show", async () => {
    await render();
    expect(tool()).toBeNull();
  });
});
