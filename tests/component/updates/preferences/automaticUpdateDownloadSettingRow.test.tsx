/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutomaticUpdateDownloadSettingRow } from "../../../../src/features/settings/main/AutomaticUpdateDownloadSettingRow";
import type { DesktopUpdateState } from "../../../../src/types/electron";
import { renderWithTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("AutomaticUpdateDownloadSettingRow", () => {
  it("shows the default-on preference and sends the user's opt-out", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const onChange = vi.fn();

    await renderRow({ onChange });

    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(host.textContent).toContain("Download updates automatically");
    expect(checkbox?.checked).toBe(true);
    checkbox?.click();
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("disables the control while saving and exposes persistence errors", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await renderRow({ saving: true, error: true });

    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Unable to save");
  });
});

async function renderRow({
  saving = false,
  error = false,
  onChange = vi.fn(),
}: {
  saving?: boolean;
  error?: boolean;
  onChange?: (enabled: boolean) => void;
}) {
  await act(async () => {
    renderWithTestLocalization(root, (
      <AutomaticUpdateDownloadSettingRow
        state={createState()}
        available
        saving={saving}
        error={error}
        onChange={onChange}
      />
    ));
  });
}

function createState(): DesktopUpdateState {
  return {
    status: "idle",
    currentVersion: "1.4.0",
    channel: "stable",
    automaticallyDownloadUpdates: true,
    availableVersion: null,
    updateInfo: null,
    progress: null,
    blockers: [],
    error: null,
    reason: null,
    lastCheckedAt: null,
    updatedAt: "2026-09-15T00:00:00.000Z",
  };
}
