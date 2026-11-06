/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createResourceUri, type Workspace, type WorkspaceFolder } from "@puppyone/shared-ui";
import { DesktopWindowChrome } from "../../../../src/components/DesktopWindowChrome";
import { DeviceFolderHeader, DeviceFolderHeaderActions } from "../../../../src/app/DeviceFolderHeader";
import { initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../../../../src/platform/useDesktopPlatformCapabilities", () => ({
  useDesktopPlatformCapabilities: () => ({ platform: "windows", windowChrome: { mode: "overlay" } }),
}));

const uri = createResourceUri({ scheme: "puppyone-device", authority: "computer.example.invalid", path: "notes" });
const workspace: Workspace = { id: uri, name: "Notes", path: uri, status: "recording" };
const folder: WorkspaceFolder = { id: uri, name: "Notes", uri, index: 0, workspace,
  capabilities: { read: true, write: false, execute: false, watch: true }, trustState: "untrusted" };
let root: Root;
let container: HTMLDivElement;
const onHome = vi.fn();

beforeEach(() => {
  localStorage.clear(); initializeDesktopPreferences();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.clearAllMocks(); });

async function render(props: Partial<React.ComponentProps<typeof DeviceFolderHeader>> = {}) {
  await act(async () => root.render(withTestLocalization(<DesktopWindowChrome context={<DeviceFolderHeader
    workspace={workspace} folder={folder} hostName="Studio Mac" writable={false} onHome={onHome} {...props} />} />)));
}

function openProjectMenu() {
  act(() => container.querySelector<HTMLButtonElement>(".desktop-titlebar-workspace-button")!.click());
}

describe("remote folder Header", () => {
  it.each([false, true])("uses the shared project and named-computer controls, keeping access inside the place menu (%s)", async writable => {
    await render({ writable });
    const header = container.querySelector("header")!;
    expect(header.querySelector(".desktop-titlebar-workspace-name")?.textContent).toBe("Notes");
    const place = header.querySelector<HTMLButtonElement>('[data-project-place="computer"]')!;
    expect(place.textContent).toBe("Studio Mac");
    expect(place.getAttribute("aria-label")).not.toContain("This computer");
    expect(header.textContent).not.toMatch(/Remote folder|View only|Can edit|puppyone-device:/);
    expect(header.getAttribute("data-workspace-kind")).not.toBe("cloud");
    act(() => place.click());
    const current = document.querySelector('[data-project-place-row="current"]')!;
    expect(current.textContent).toContain("Studio Mac");
    expect(current.textContent).toContain(writable ? "Can edit" : "View only");
    expect(document.querySelector('[data-project-place-row="put-in-cloud"]')).toBeNull();
    expect(document.querySelector('[data-project-place-row="other-computers"]')).toBeNull();
  });

  it("keeps Home and local/Cloud project navigation in the existing project menu", async () => {
    const onSelectProject = vi.fn();
    const onSelectCloudProject = vi.fn();
    await render({ onSelectProject, onSelectCloudProject, projectItems: [
      { id: "local", label: "Local notes", localPath: "/tmp/notes" },
      { id: "cloud", label: "Cloud notes", localPath: "", cloudProjectId: "cloud-notes" },
    ] });
    const select = (label: string) => {
      openProjectMenu();
      const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .find(button => button.textContent?.includes(label))!;
      expect(item).toBeDefined();
      act(() => item.click());
    };
    select("Local notes"); expect(onSelectProject).toHaveBeenCalledWith("/tmp/notes");
    select("Cloud notes"); expect(onSelectCloudProject).toHaveBeenCalledWith("cloud-notes");
    select("Home"); expect(onHome).toHaveBeenCalledOnce();
  });

  it("shows only allowed remote commands with the shared Header button treatment", async () => {
    const onToggle = vi.fn();
    await act(async () => root.render(withTestLocalization(<DesktopWindowChrome actions={<DeviceFolderHeaderActions
      tools={["git", "agent"]} activeTool="git" onToggle={onToggle} />} />)));
    const commands = [...container.querySelectorAll<HTMLButtonElement>(".desktop-titlebar-action")];
    expect(commands.map(button => button.getAttribute("aria-label"))).toEqual(["Changes", "Agent"]);
    expect(commands.map(button => button.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    act(() => commands[1]!.click());
    expect(onToggle).toHaveBeenCalledWith("agent");
    expect(container.querySelector('button[aria-label="Terminal"]')).toBeNull();
  });
});
