/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopUpdateSettingsRow } from "../../../../src/features/updates/DesktopUpdateSettingsRow";
import type { DesktopUpdateState, DesktopUpdateStatus } from "../../../../src/types/electron";
import { renderWithTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("DesktopUpdateSettingsRow", () => {
  it("distinguishes a verified current release from an available update", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const onUpdateNow = vi.fn();

    await renderState(host, createState("not-available"), onUpdateNow);

    let button = host.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toContain("Already up to date");
    expect(button?.disabled).toBe(true);
    expect(button?.title).toBe("Version 1.4.0 is up to date.");

    await renderState(host, createState("available"), onUpdateNow);

    button = host.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toContain("Download update");
    expect(button?.disabled).toBe(false);
    button?.click();
    expect(onUpdateNow).toHaveBeenCalledTimes(1);
  });

  it("offers restart only after the update is downloaded", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const onUpdateNow = vi.fn();

    await renderState(host, createState("downloaded"), onUpdateNow);

    const button = host.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toContain("Restart to update");
    expect(button?.disabled).toBe(false);
    button?.click();
    expect(onUpdateNow).toHaveBeenCalledOnce();
  });

  it("identifies a development build without claiming that it is current", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await renderState(host, {
      ...createState("disabled"),
      channel: "dev",
      reason: "Auto updates are disabled for Development builds.",
    });

    const button = host.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toContain("Development build");
    expect(button?.textContent).not.toContain("Already up to date");
    expect(button?.disabled).toBe(true);
    expect(button?.title).toBe("Auto updates are disabled for Development builds.");
  });
});

async function renderState(
  host: HTMLElement,
  state: DesktopUpdateState,
  onUpdateNow = vi.fn(),
) {
  await act(async () => {
    renderWithTestLocalization(root, (
      <DesktopUpdateSettingsRow
        state={state}
        onCheckForUpdates={vi.fn()}
        onUpdateNow={onUpdateNow}
      />
    ));
  });
  expect(host.querySelector("button")).not.toBeNull();
}

function createState(status: DesktopUpdateStatus): DesktopUpdateState {
  return {
    status,
    currentVersion: "1.4.0",
    channel: "stable",
    automaticallyDownloadUpdates: true,
    availableVersion: status === "available" || status === "downloaded" ? "1.5.0" : null,
    updateInfo: null,
    progress: null,
    blockers: [],
    error: null,
    reason: null,
    lastCheckedAt: status === "not-available" ? "2026-08-26T00:00:00.000Z" : null,
    updatedAt: "2026-08-26T00:00:00.000Z",
  };
}
