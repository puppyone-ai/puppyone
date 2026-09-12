// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useSubThemeNativeMenu,
  useSubThemeCatalog,
  type SubThemeCatalogController,
} from "../../../../src/features/themes/useSubThemeCatalog";
import type { DesktopThemeSnapshot } from "../src/types/electron";
import {
  createSubThemeCatalogSnapshot,
  getCompatibleSubThemes,
} from "../../../../src/features/themes/builtinSubThemes";
import { getSubThemeModes } from "../../../../src/features/themes/themeTypes";

let container: HTMLDivElement;
let root: Root;
let latest: SubThemeCatalogController | null;
const originalDesktopApi = window.puppyoneDesktop;

beforeEach(() => {
  latest = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.puppyoneDesktop = originalDesktopApi;
});

describe("renderer Sub Theme catalog", () => {
  it("normalizes host mode declarations into explicit variants and filters by effective mode", () => {
    const catalog = createSubThemeCatalogSnapshot(snapshot("com.example.light-only"));
    const installed = catalog.subThemes.find(({ id }) => id === "com.example.light-only");

    expect(installed && getSubThemeModes(installed)).toEqual(["light"]);
    expect(getCompatibleSubThemes(catalog, "default", "light").map(({ id }) => id))
      .toContain("com.example.light-only");
    expect(getCompatibleSubThemes(catalog, "default", "dark").map(({ id }) => id))
      .not.toContain("com.example.light-only");
  });

  it("loads variants and refreshes them when the window regains focus", async () => {
    const first = snapshot("com.example.first");
    const second = snapshot("com.example.second");
    const list = vi.fn().mockResolvedValueOnce(first).mockResolvedValue(second);
    window.puppyoneDesktop = {
      themes: {
        list,
        openDirectory: vi.fn(async () => ({ opened: true as const })),
        create: vi.fn(async () => ({ created: true as const, themeId: "local.user.custom-theme" })),
      },
    } as typeof window.puppyoneDesktop;

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    expect(list).toHaveBeenCalledOnce();
    expect(latest?.status).toBe("ready");
    expect(latest?.snapshot.subThemes.some(({ id }) => id === "default.neutral")).toBe(true);
    expect(latest?.snapshot.subThemes.some(({ id }) => id === "com.example.first")).toBe(true);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(list).toHaveBeenCalledTimes(2);
    expect(latest?.snapshot.subThemes.some(({ id }) => id === "com.example.first")).toBe(false);
    expect(latest?.snapshot.subThemes.some(({ id }) => id === "com.example.second")).toBe(true);
  });

  it("uses the six built-in variants when the desktop host API is unavailable", async () => {
    window.puppyoneDesktop = undefined;

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    expect(latest?.status).toBe("ready");
    expect(latest?.error).toBeNull();
    expect(latest?.snapshot.subThemes.map(({ id }) => id)).toEqual([
      "default.neutral",
      "default.warm",
      "default.graphite",
      "default.github",
      "default.newspaper",
      "windows-xp.luna-blue",
    ]);
  });

  it("surfaces failures while opening the themes directory", async () => {
    window.puppyoneDesktop = {
      themes: {
        list: vi.fn(async () => ({ themes: [], diagnostics: [] })),
        openDirectory: vi.fn(async () => { throw new Error("Finder unavailable"); }),
        create: vi.fn(async () => ({ created: true as const, themeId: "local.user.custom-theme" })),
      },
    } as typeof window.puppyoneDesktop;
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    let result: { opened: boolean } | undefined;
    await act(async () => {
      result = await latest?.openDirectory();
    });

    expect(result).toEqual({ opened: false });
    expect(latest?.status).toBe("error");
    expect(latest?.error).toBe("Finder unavailable");
  });

  it("creates a local theme through the pathless host command and refreshes the catalog", async () => {
    const createdSnapshot = snapshot("local.user.custom-theme");
    const list = vi.fn()
      .mockResolvedValueOnce({ themes: [], diagnostics: [] })
      .mockResolvedValue(createdSnapshot);
    const create = vi.fn(async () => ({
      created: true as const,
      themeId: "local.user.custom-theme",
    }));
    window.puppyoneDesktop = {
      themes: {
        list,
        openDirectory: vi.fn(async () => ({ opened: true as const })),
        create,
      },
    } as typeof window.puppyoneDesktop;

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    let result: { created: boolean; themeId?: string } | undefined;
    await act(async () => {
      result = await latest?.createTheme();
    });

    expect(result).toEqual({ created: true, themeId: "local.user.custom-theme" });
    expect(create).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledTimes(2);
    expect(latest?.snapshot.subThemes.some(({ id }) => id === "local.user.custom-theme"))
      .toBe(true);
  });

  it("syncs only root-compatible variants to the native menu and routes requests", async () => {
    const syncNativeMenu = vi.fn(async () => ({ synced: true as const }));
    let requestSelection: ((request: { kind: "pack"; themeId: string }) => void) | undefined;
    const onSubThemeChange = vi.fn();
    window.puppyoneDesktop = {
      themes: {
        list: vi.fn(async () => ({ themes: [], diagnostics: [] })),
        openDirectory: vi.fn(async () => ({ opened: true as const })),
        create: vi.fn(async () => ({ created: true as const, themeId: "local.user.custom-theme" })),
        syncNativeMenu,
        onSelectionRequested: vi.fn((callback) => {
          requestSelection = callback;
          return () => undefined;
        }),
      },
    } as typeof window.puppyoneDesktop;

    await act(async () => {
      root.render(<NativeHarness onSubThemeChange={onSubThemeChange} />);
      await Promise.resolve();
    });

    const request = syncNativeMenu.mock.calls.at(-1)?.[0];
    expect(request).toMatchObject({
      pack: "default.github",
      requiredTargets: ["application", "markdown", "csv"],
    });
    expect(request?.themes.map(({ id }: { id: string }) => id)).toEqual([
      "default.neutral",
      "default.warm",
      "default.graphite",
      "default.github",
      "default.newspaper",
    ]);
    act(() => requestSelection?.({ kind: "pack", themeId: "default.newspaper" }));
    expect(onSubThemeChange).toHaveBeenCalledWith("default.newspaper");
  });
});

function Harness() {
  latest = useSubThemeCatalog();
  return null;
}

function NativeHarness({
  onSubThemeChange,
}: {
  onSubThemeChange: (subThemeId: string) => void;
}) {
  const catalog = useSubThemeCatalog();
  latest = catalog;
  useSubThemeNativeMenu({
    snapshot: catalog.snapshot,
    rootThemeId: "default",
    colorMode: "light",
    selectedSubThemeId: "default.github",
    onSubThemeChange,
  });
  return null;
}

function snapshot(id: string): DesktopThemeSnapshot {
  return {
    themes: [{
      id,
      name: id,
      version: "1.0.0",
      contractVersion: 1,
      compatibleRootThemeIds: ["default"],
      modes: ["light"],
      targets: ["markdown"],
      source: "local-package",
      compiledCss: {
        markdown: `[data-po-appearance-root][data-sub-theme-id="${id}"] { --po-host-md-content-color: red; }`,
      },
    }],
    diagnostics: [],
  };
}
