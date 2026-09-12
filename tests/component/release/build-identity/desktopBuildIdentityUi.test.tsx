/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DesktopBuildVersionSettingsRow,
  formatDesktopBuildDiagnostics,
} from "../../../../src/features/build-info/DesktopBuildIdentity";
import { resetDesktopBuildInfoCacheForTests } from "../../../../src/features/build-info/useDesktopBuildInfo";
import type { DesktopBuildInfo } from "../src/types/electron";
import { renderWithTestLocalization } from "../../../support/react/localization";
import zhHansCatalog from "../../../../src/localization/catalog-loaders/zh-Hans";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalDesktopBridge = window.puppyoneDesktop;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  window.puppyoneDesktop = originalDesktopBridge;
  resetDesktopBuildInfoCacheForTests();
});

describe("Desktop Build Identity UI", () => {
  it("uses the canonical localized product names for all three channels", () => {
    const common = {
      schemaVersion: 1 as const,
      product: "puppyone-desktop" as const,
      baseVersion: "1.4.0",
      commitSha: "e".repeat(40),
      builtAt: "2026-07-26T10:00:00.000Z",
      sourceDirty: false,
    };
    expect([
      zhHansCatalog["shell.build.channel.dev"],
      zhHansCatalog["shell.build.channel.internal"],
      zhHansCatalog["shell.build.channel.stable"],
    ]).toEqual(["开发版", "内测版", "正式版"]);
    expect(formatDesktopBuildDiagnostics({
      ...common,
      channel: "internal",
      version: "1.4.0-internal.72",
      buildId: "72",
      platformBuildNumber: "72",
    })).toContain(`Commit: ${"e".repeat(40)}`);
  });

  it("shows the exact Internal build in Settings", async () => {
    const buildInfo: DesktopBuildInfo = {
      schemaVersion: 1,
      product: "puppyone-desktop",
      channel: "internal",
      baseVersion: "1.4.0",
      version: "1.4.0-internal.72",
      buildId: "72",
      platformBuildNumber: "72",
      commitSha: "e".repeat(40),
      builtAt: "2026-07-26T10:00:00.000Z",
      sourceDirty: false,
    };
    const getBuildInfo = vi.fn(async () => buildInfo);
    window.puppyoneDesktop = { getBuildInfo } as Window["puppyoneDesktop"];
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      renderWithTestLocalization(root,
        <DesktopBuildVersionSettingsRow />,
      );
      await Promise.resolve();
    });

    expect(getBuildInfo).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".desktop-build-version-row")?.textContent)
      .toContain("VersionInternal · 1.4.0-internal.72");
    expect(container.querySelector(".desktop-build-version-text")?.tagName).toBe("SPAN");
    expect(container.querySelector('[aria-label="Copy version information"]')).not.toBeNull();
    expect(container.querySelector('[data-build-channel="internal"]')?.getAttribute("title"))
      .toContain("commit eeeeeeee");
  });

  it("renders nothing when running without the Electron bridge", async () => {
    window.puppyoneDesktop = undefined;
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      renderWithTestLocalization(root, <DesktopBuildVersionSettingsRow />);
      await Promise.resolve();
    });

    expect(container.childElementCount).toBe(0);
  });
});
