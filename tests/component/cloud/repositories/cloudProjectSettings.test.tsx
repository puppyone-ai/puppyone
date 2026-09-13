import type { DesktopCloudProject } from "../../../../src/lib/cloudApi";
/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudProjectSettingsSection } from "../../../../src/features/cloud/sections/settings";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let bridge: ReturnType<typeof vi.fn>;

beforeEach(() => {
  bridge = vi.fn();
  (window as unknown as { puppyoneDesktop: unknown }).puppyoneDesktop = {
    requestCloudSessionApi: bridge,
  };
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  delete (window as unknown as { puppyoneDesktop?: unknown }).puppyoneDesktop;
});

describe("CloudProjectSettingsSection", () => {
  it("uses the catalog style and keeps project settings inside Desktop", async () => {
    const onRefresh = vi.fn(async () => undefined);
    const onRemove = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(withTestLocalization(
      <CloudProjectSettingsSection
        project={PROJECT}
        cloudSession={SESSION}
        apiBaseUrl="https://api.puppyone.ai/api/v1"
        loading={false}
        matchesRepositoryRemote
        removeRemoteAction={{ onRemove }}
        onSessionChange={vi.fn()}
        onRefresh={onRefresh}
        onSelectSection={vi.fn()}
      />,
    )));

    expect(container.querySelector(".desktop-cloud-settings-catalog")).not.toBeNull();
    expect(container.textContent).toContain("Project details");
    expect(container.textContent).not.toContain("Open project settings");
    expect(container.textContent).not.toContain("Open on web");

    const nameInput = container.querySelector<HTMLInputElement>(".desktop-cloud-settings-field input:not(.mono)");
    act(() => {
      if (!nameInput) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(nameInput, "Atlas 2");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(nameInput?.value).toBe("Atlas 2");
    expect(findButton(container, "Save changes")?.disabled).toBe(false);
    bridge.mockResolvedValueOnce({ ...PROJECT, name: "Atlas 2" });
    await act(async () => {
      findButton(container, "Save changes")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Project settings saved.");
    expect(bridge).toHaveBeenCalledWith(expect.objectContaining({
      path: "/projects/project-1",
      method: "PUT",
    }));
    expect(onRefresh).toHaveBeenCalledOnce();

    act(() => findButton(container, "Access")?.click());
    expect(container.textContent).toContain("Project visibility");
    expect(container.textContent).toContain("Organization");
    expect(container.textContent).toContain("Private");

    act(() => findButton(container, "Connection")?.click());
    expect(container.textContent).toContain("Repository connection");
    act(() => findButton(container, "Remove Cloud Git remote")?.click());
    act(() => findButtonStartingWith(container, "Remove the PuppyOne Git remote?")?.click());
    expect(onRemove).toHaveBeenCalledOnce();
  });
});

function findButton(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === label);
}

function findButtonStartingWith(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim().startsWith(label));
}

const PROJECT: DesktopCloudProject = {
  id: "project-1",
  name: "Atlas",
  description: "Product research",
  visibility: "org",
  bound_git_branch: "main",
  capabilities: ["project.read", "project.settings.manage"],
};

const SESSION = {
  expires_in: 3600,
  expires_at: 0,
  user_id: "user-1",
  user_email: "dev@example.com",
  api_base_url: "https://api.puppyone.ai/api/v1",
  session_generation: "generation-1",
  status: "authenticated",
} as const;
