/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopUpdateTitlebarButton } from "../../../../src/features/updates/DesktopUpdateTitlebarButton";
import type { DesktopUpdateState, DesktopUpdateStatus } from "../../../../src/types/electron";
import { renderWithTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("DesktopUpdateTitlebarButton", () => {
  it.each(["available", "downloading"] as const)("does not interrupt the titlebar while the update is %s", async (status) => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await renderState(createState(status));

    expect(host.querySelector("button")).toBeNull();
  });

  it("offers one restart action after the update is downloaded", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const onUpdateNow = vi.fn();

    await renderState(createState("downloaded"), onUpdateNow);

    const button = host.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toBe("Restart to update");
    expect(button?.title).toBe("Version 1.5.0 is ready to install.");
    expect(button?.disabled).toBe(false);
    button?.click();
    expect(onUpdateNow).toHaveBeenCalledOnce();
  });

  it("offers a download action when automatic downloads are disabled", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const onUpdateNow = vi.fn();

    await renderState({
      ...createState("available"),
      automaticallyDownloadUpdates: false,
    }, onUpdateNow);

    const button = host.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toBe("Download update");
    expect(button?.title).toBe("Update 1.5.0 available");
    button?.click();
    expect(onUpdateNow).toHaveBeenCalledOnce();
  });
});

async function renderState(
  state: DesktopUpdateState,
  onUpdateNow = vi.fn(),
) {
  await act(async () => {
    renderWithTestLocalization(root, (
      <DesktopUpdateTitlebarButton state={state} onUpdateNow={onUpdateNow} />
    ));
  });
}

function createState(status: DesktopUpdateStatus): DesktopUpdateState {
  return {
    status,
    currentVersion: "1.4.0",
    channel: "stable",
    automaticallyDownloadUpdates: true,
    availableVersion: "1.5.0",
    updateInfo: null,
    progress: status === "downloading"
      ? { percent: 40, bytesPerSecond: 0, transferred: 40, total: 100 }
      : null,
    blockers: [],
    error: null,
    reason: null,
    lastCheckedAt: null,
    updatedAt: "2026-09-15T00:00:00.000Z",
  };
}
