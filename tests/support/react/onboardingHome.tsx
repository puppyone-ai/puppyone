import { initializeDesktopPreferences } from "../../../src/preferencesStore";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { HOMEPAGE_PROJECT_LAYOUT_STORAGE_KEY } from "../../../src/preferenceStorage";
import { PUPPY_BRAND_MARK_ASSETS } from "../../../src/components/brand/PuppyBrandMark";
import type { WorkspaceImportSourceResult, WorkspaceCreateProjectRequest, WorkspaceCreateProjectResult, DesktopTelemetryState } from "../../../src/types/electron";
import { DEFAULT_EXPERIMENTAL_SETTINGS } from "../../../src/preferences";
import { HomeWithEntryFlow, type HomeWithEntryFlowProps } from "./homeWithEntryFlow";
import { renderWithTestLocalization } from "./localization";
import { createTestSurfaceAppearance } from "./surfaceAppearance";

/**
 * The Homepage as a person meets it, for the tests of its page, its New project
 * dialog, its imports and its project actions: one mounted Homepage per test,
 * a clean store and bridge between them.
 */
let root: Root | null = null;

export const ALL_EXPERIMENTAL_IMPORTS = {
  ...DEFAULT_EXPERIMENTAL_SETTINGS,
  enableOtherAppImports: true,
};

/** Mounts a surface other than the Homepage, unmounted with it after the test. */
export function mountRoot(container: HTMLElement): Root {
  root = createRoot(container);
  return root;
}

/** Registers the shared setup in the calling test file. */
export function setUpOnboardingHome() {
  const originalClipboard = navigator.clipboard;
  const originalConfirm = window.confirm;
  beforeEach(() => { localStorage.clear(); localStorage.setItem(HOMEPAGE_PROJECT_LAYOUT_STORAGE_KEY, "list"); initializeDesktopPreferences(); });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
    });
    Object.defineProperty(window, "confirm", {
      configurable: true,
      value: originalConfirm,
    });
    delete window.puppyoneDesktop;
    window.localStorage.clear();
    vi.useRealTimers();
  });
}

export const notesProject = { id: "notes", label: "Notes", localPath: "/Users/example/Desktop/Notes", lastOpenedAt: null };

export const projectMenuItem = (label: string) => [...document.body.querySelectorAll<HTMLButtonElement>(".desktop-project-row-actions-menu .desktop-menu-item")]
  .find((item) => item.textContent === label);

export function renderHome(
  overrides: Partial<Omit<HomeWithEntryFlowProps, "appearance">> & Pick<Partial<HomeWithEntryFlowProps>, "appearance"> = {},
  appearanceInput: Parameters<typeof createTestSurfaceAppearance>[0] = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props: HomeWithEntryFlowProps = {
    onChooseWorkspace: vi.fn(async () => undefined),
    onOpenDroppedWorkspace: vi.fn(async () => undefined),
    onOpenWorkspacePath: vi.fn(async () => undefined),
    appearance: createTestSurfaceAppearance(appearanceInput),
    ...overrides,
  };
  props.onConnectImportSource ??= vi.fn(async () => ({ connectionId: "test-connection" }));
  props.onListImportResources ??= vi.fn(async () => ({ items: [], nextCursor: null }));
  props.onCancelImportSource ??= vi.fn(async () => ({ cancelled: true }));
  props.onImportSourceProgress ??= vi.fn(() => () => undefined);
  act(() => renderWithTestLocalization(root, React.createElement(HomeWithEntryFlow, props)));
  return container;
}

export function expectBrandLockup(
  container: HTMLElement,
  state: "empty" | "projects" = "empty",
  expectedMarkAsset: string = PUPPY_BRAND_MARK_ASSETS.dark,
) {
  const lockup = container.querySelector(".onboarding-brand-lockup");
  const brand = state === "projects" ? container.querySelector(".desktop-titlebar .onboarding-header-brand") : lockup;
  const mark = brand?.querySelector<HTMLImageElement>("img");
  if (state === "projects") {
    // The Header names the product without its mark.
    expect(mark).toBeNull();
    expect(brand?.textContent).toBe("puppyone");
    expect(lockup?.querySelector("img")).toBeNull();
    expect(lockup?.querySelector(".onboarding-brand-name")).toBeNull();
  } else {
    expect(mark?.getAttribute("src")).toContain(expectedMarkAsset);
    expect(mark?.getAttribute("alt")).toBe("");
    expect(lockup?.querySelector(".onboarding-brand-name")?.textContent).toBe("Start with your files. Agent-ready.");
  }
  expect(lockup?.querySelectorAll("p")).toHaveLength(0);
  expect(lockup?.querySelector(".onboarding-brand-tagline")).toBeNull();
  expect(lockup?.querySelector(".onboarding-brand-version")).toBeNull();
  expect(container.querySelector(".onboarding-brand-context")).toBeNull();
}

export function requireSurface(container: HTMLElement): HTMLElement {
  const surface = container.querySelector<HTMLElement>(".onboarding-homepage-shell");
  if (!surface) throw new Error("Project home surface is missing.");
  return surface;
}

export function installFirstLaunchTelemetryBridge() {
  const initial: DesktopTelemetryState = {
    schemaVersion: 2,
    defaultLevel: "basic",
    level: "basic",
    effectiveLevel: "off",
    enabled: false,
    eligible: true,
    disabledReason: "notice-required",
    noticeVersion: 2,
    noticeSeenVersion: 0,
    noticeRequired: true,
    transportConfigured: true,
    queuedEventCount: 0,
  };
  const seen: DesktopTelemetryState = {
    ...initial,
    effectiveLevel: "basic",
    enabled: true,
    disabledReason: null,
    noticeSeenVersion: 2,
    noticeRequired: false,
  };
  const bridge = {
    getTelemetryState: vi.fn().mockResolvedValue(initial),
    markTelemetryNoticeSeen: vi.fn().mockResolvedValue(seen),
    onTelemetryStateChanged: vi.fn(() => vi.fn()),
    openExternalUrl: vi.fn().mockResolvedValue({ ok: true }),
  };
  Object.defineProperty(window, "puppyoneDesktop", {
    configurable: true,
    value: bridge,
  });
  return bridge;
}

export function createDragEvent(type: string, dataTransfer: DataTransfer): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  return event;
}

export function createTransfer(
  files: File[],
  entries: Array<{ isDirectory: boolean }>,
): DataTransfer {
  const fileList = Object.assign([...files], {
    item: (index: number) => files[index] ?? null,
  }) as unknown as FileList;
  const items = entries.map((entry) => ({
    kind: "file",
    webkitGetAsEntry: () => ({
      isDirectory: entry.isDirectory,
      isFile: !entry.isDirectory,
      name: "entry",
      fullPath: "/entry",
      filesystem: {},
      getParent: () => undefined,
    }),
  }));
  return {
    files: fileList,
    items,
    types: ["Files"],
    dropEffect: "none",
  } as unknown as DataTransfer;
}

export function createTextTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    files: Object.assign([], { item: () => null }) as unknown as FileList,
    items: [],
    types: [],
    dropEffect: "none",
    effectAllowed: "none",
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => {
      values.set(type, value);
    },
  } as unknown as DataTransfer;
}

export function setInputValue(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error("Project entry input is missing.");
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export async function createProjectResult(request: WorkspaceCreateProjectRequest): Promise<WorkspaceCreateProjectResult> {
  return {
    initialization: { operationId: request.operationId, outcome: "committed", name: request.name, path: "/projects/" + request.name, createdPaths: ["Getting Started.md"], initialOpenPath: "Getting Started.md", template: null },
    opening: { status: "opened", result: { status: "opened-current", workspaceId: "test", path: "/projects/" + request.name, workspace: null } },
  };
}

export async function importProjectResult(): Promise<WorkspaceImportSourceResult> {
  return {
    project: { path: "/projects/imported", name: "imported", provider: "github" },
    opening: { status: "opened", result: { status: "opened-current", workspaceId: "test", path: "/projects/imported", workspace: null } },
  };
}
