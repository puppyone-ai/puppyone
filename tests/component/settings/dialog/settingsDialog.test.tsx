/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog, type SettingsDialogProps } from "../../../../src/features/settings/SettingsDialog";
import { renderWithTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/features/settings/SettingsWorkspaceSurface", () => ({
  createSettingsWorkspaceSurface: ({ cloud }: SettingsDialogProps) => ({
    sidebar: <div data-testid="settings-navigation">Navigation</div>,
    main: <div data-testid="settings-content" data-space-id={cloud.spaceId}>Content</div>,
  }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("SettingsDialog", () => {
  it("manages only the Space it was opened on and offers no way to switch", () => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const props = { onClose: vi.fn(), activeSection: "seats", cloud: { enabled: true,
      spaceId: "a", spaceName: "Studio", session: { user_id: "owner", session_generation: "one" },
      apiBaseUrl: "https://example.test" } } as unknown as SettingsDialogProps;
    const render = (value: SettingsDialogProps) => act(() => renderWithTestLocalization(root!, <SettingsDialog {...value} />));
    render(props);
    expect(host.querySelector("select")).toBeNull();
    expect(host.querySelector('[data-testid="settings-content"]')?.getAttribute("data-space-id")).toBe("a");
    render({ ...props, cloud: { ...props.cloud, spaceId: "b", spaceName: "Research" } });
    expect(host.querySelector('[data-testid="settings-content"]')?.getAttribute("data-space-id")).toBe("b");
    expect(host.querySelector("select")).toBeNull();
  });

  it("hosts Settings in a dismissible, two-column dialog", () => {
    const host = document.createElement("div");
    const onClose = vi.fn();
    document.body.append(host);
    root = createRoot(host);

    act(() => renderWithTestLocalization(root,
      <SettingsDialog {...({ onClose, cloud: { session: null } } as unknown as SettingsDialogProps)} />,
    ));

    const dialog = host.querySelector<HTMLElement>(".desktop-settings-dialog");
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.getAttribute("aria-label")).toBe("Settings");
    expect(dialog?.querySelector("[data-testid='settings-navigation']")?.textContent)
      .toBe("Navigation");
    expect(dialog?.querySelector("[data-testid='settings-content']")?.textContent)
      .toBe("Content");
    expect(dialog?.querySelector(".desktop-settings-dialog-layout")).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
