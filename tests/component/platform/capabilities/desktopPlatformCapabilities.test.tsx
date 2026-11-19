/** @vitest-environment happy-dom */
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { readDesktopPlatformCapabilities, resetDesktopPlatformCapabilitiesForTests } from "../../../../src/platform/desktopPlatformClient";
import { useDesktopPlatformCapabilities } from "../../../../src/platform/useDesktopPlatformCapabilities";
import type { DesktopPlatformCapabilities } from "../../../../src/types/electron";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
const originalBridge = window.puppyoneDesktop;
const capabilities: DesktopPlatformCapabilities = {
  schemaVersion: 1, platform: "macos", arch: "arm64", primaryModifier: "meta",
  windowChrome: { mode: "native" },
  credentialStorage: { available: false, locked: false, strength: "unavailable", backend: null },
  documentConversion: { supportedInputs: [] },
  updater: { supported: false, installMode: "manual" },
};

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  window.puppyoneDesktop = originalBridge;
  resetDesktopPlatformCapabilitiesForTests();
});

it("starts every reopened control with the resolved host identity on its first visible commit", async () => {
  resetDesktopPlatformCapabilitiesForTests();
  const read = vi.fn(async () => capabilities);
  window.puppyoneDesktop = { ...originalBridge, getPlatformCapabilities: read } as NonNullable<typeof originalBridge>;
  await readDesktopPlatformCapabilities();
  const commits: Array<string | null> = [];
  function Control() {
    const host = useDesktopPlatformCapabilities();
    useLayoutEffect(() => { commits.push(host?.platform ?? null); }, [host]);
    return <span>{host?.platform ?? "Waiting"}</span>;
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  for (let opening = 0; opening < 3; opening++) {
    await act(async () => root?.render(<Control />));
    expect(container.textContent).toBe("macos");
    act(() => root?.render(null));
  }
  expect(commits).toEqual(["macos", "macos", "macos"]);
  expect(read).toHaveBeenCalledOnce();
});
