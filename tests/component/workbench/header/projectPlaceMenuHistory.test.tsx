/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectPlaceRows, type ProjectPlaceHandlers } from "../../../../src/features/app-shell/project-place/ProjectPlaceMenu";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => undefined;
const handlers: ProjectPlaceHandlers = { onPutInCloud: noop, onOpenCloudProject: noop, onSignIn: noop,
  onPutInCloudAgain: noop, onOpenLocalFolder: noop };
const row = () => document.querySelector<HTMLElement>('[data-project-place-row="history"]');
let root: Root;
const render = async (extra: Partial<ProjectPlaceHandlers>, onDismiss = vi.fn()) => {
  await act(async () => root.render(withTestLocalization(<ProjectPlaceRows
    menu={{ place: "cloud", action: null }} handlers={{ ...handlers, ...extra }} onDismiss={onDismiss} />)));
  return onDismiss;
};
beforeEach(() => { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); });

describe("History in the project's place menu", () => {
  it("is offered where the project has a record, and closes the menu when opened", async () => {
    const onOpenHistory = vi.fn();
    const onDismiss = await render({ onOpenHistory });
    expect(row()?.textContent).toContain("History");
    await act(async () => row()!.click());
    expect(onOpenHistory).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
  it("is absent where there is nothing to show", async () => {
    await render({});
    expect(row()).toBeNull();
  });
});
