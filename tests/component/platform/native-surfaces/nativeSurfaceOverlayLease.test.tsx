/**
 * @vitest-environment happy-dom
 */
import React, { StrictMode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopDialogRoot } from "../../../../src/components/DesktopDialog";
import { DesktopMenuSurface } from "../../../../src/components/DesktopMenu";
import { DesktopOverlayPortal } from "../../../../src/features/app-shell/DesktopOverlayPortal";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement;
let publish: ReturnType<typeof vi.fn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  publish = vi.fn();
  Object.defineProperty(window, "puppyoneDesktop", {
    configurable: true,
    value: { setNativeSurfaceOccluded: publish },
  });
});

afterEach(async () => {
  act(() => root?.unmount());
  root = null;
  await act(async () => { await Promise.resolve(); });
  delete window.puppyoneDesktop;
  document.body.innerHTML = "";
});

describe("native surface overlay lease", () => {
  it("keeps native content hidden until the final menu or dialog closes", async () => {
    act(() => root?.render(<DesktopMenuSurface>Menu</DesktopMenuSurface>));
    expect(publish.mock.calls).toEqual([[{ occluded: true }]]);

    act(() => root?.render(
      <>
        <DesktopMenuSurface>Menu</DesktopMenuSurface>
        <DesktopDialogRoot>Dialog</DesktopDialogRoot>
      </>,
    ));
    expect(publish).toHaveBeenCalledTimes(1);

    act(() => root?.render(<DesktopDialogRoot>Dialog</DesktopDialogRoot>));
    await act(async () => { await Promise.resolve(); });
    expect(publish).toHaveBeenCalledTimes(1);

    act(() => root?.unmount());
    root = null;
    await act(async () => { await Promise.resolve(); });
    expect(publish.mock.calls).toEqual([[{ occluded: true }], [{ occluded: false }]]);
  });

  it("does not flash native content during React StrictMode effect replay", async () => {
    act(() => root?.render(
      <StrictMode>
        <DesktopMenuSurface>Menu</DesktopMenuSurface>
      </StrictMode>,
    ));
    await act(async () => { await Promise.resolve(); });
    expect(publish.mock.calls).toEqual([[{ occluded: true }]]);
  });

  it("observes explicitly marked cross-package and imperative overlays", async () => {
    act(() => root?.render(<DesktopOverlayPortal>Overlay host</DesktopOverlayPortal>));
    expect(publish).not.toHaveBeenCalled();

    const imperativeMenu = document.createElement("div");
    imperativeMenu.dataset.nativeSurfaceOccluder = "true";
    document.body.appendChild(imperativeMenu);
    await vi.waitFor(() => {
      expect(publish).toHaveBeenLastCalledWith({ occluded: true });
    });

    imperativeMenu.remove();
    await vi.waitFor(() => {
      expect(publish).toHaveBeenLastCalledWith({ occluded: false });
    });
  });

  it("marks the overlay root with the effective application theme", async () => {
    act(() => root?.render(
      <DesktopOverlayPortal theme="dark" subThemeId="default.forest">
        Overlay host
      </DesktopOverlayPortal>,
    ));
    await act(async () => { await Promise.resolve(); });

    const overlayRoot = document.querySelector<HTMLElement>("#desktop-overlay-root");
    expect(overlayRoot).toMatchObject({
      className: "desktop-overlay-root dark",
    });
    expect(overlayRoot?.dataset.poAppearanceRoot).toBe("true");
    expect(overlayRoot?.dataset.subThemeId).toBe("default.forest");

    act(() => root?.render(
      <DesktopOverlayPortal theme="dark">Overlay host</DesktopOverlayPortal>,
    ));
    await act(async () => { await Promise.resolve(); });
    expect(overlayRoot?.dataset.subThemeId).toBeUndefined();
  });
});
