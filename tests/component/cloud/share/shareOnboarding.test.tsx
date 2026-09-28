/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopCloudDashboard, DesktopCloudMcpEndpoint, DesktopCloudSession } from "../../../../src/lib/cloudApi";
import type { ProjectCloudContext } from "../../../../src/features/cloud/project/context/projectCloudContext";
import { projectRootTarget } from "../../../../src/features/cloud/repositoryTarget";
import { stripBidiIsolation, withTestLocalization } from "../../../support/react/localization";

const api = vi.hoisted(() => ({
  createCloudMcpEndpoint: vi.fn(),
  createCloudScope: vi.fn(),
  deleteCloudMcpEndpoint: vi.fn(),
  listCloudScopes: vi.fn(),
  listCloudOrganizations: vi.fn(),
  getDesktopCloudWebUrl: vi.fn((path: string) => `https://cloud.example${path}`),
}));

vi.mock("../../../../src/lib/cloudApi", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/lib/cloudApi")>("../../../../src/lib/cloudApi");
  return { ...actual, ...api };
});

import {
  buildProjectShares,
  CloudShareHeaderControl,
  ShareWizardDialog,
  type PendingShare,
  type ProjectSharesState,
} from "../../../../src/features/cloud/share";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const session: DesktopCloudSession = {
  expires_in: 3600,
  expires_at: 4_102_444_800,
  user_id: "user-1",
  user_email: "dev@example.com",
  api_base_url: "https://cloud.example/api/v1",
  session_generation: "generation-1",
  status: "authenticated",
};

const resolved: ProjectCloudContext = {
  status: "resolved",
  projectId: "proj-1",
  target: projectRootTarget("proj-1"),
};

const issuedEndpoint: DesktopCloudMcpEndpoint = {
  id: "ep-new",
  project_id: "proj-1",
  path: "",
  name: "Viktor",
  api_key: "mcp_live_0123456789abcdef",
  api_key_hint: "mcp_…cdef",
  status: "active",
  accesses: [{ path: "", json_path: "", readonly: true }],
  created_at: "2026-09-28T10:00:00Z",
};

function dashboardReads(reads: Record<string, string>): DesktopCloudDashboard {
  return {
    project: { id: "proj-1", name: "Notes" },
    nodes: { total: 0, folders: 0, files: 0 },
    connections: Object.entries(reads).map(([id, lastSyncedAt]) => ({
      id,
      provider: "mcp",
      status: "active",
      last_synced_at: lastSyncedAt,
    })),
    tools: [],
  } as unknown as DesktopCloudDashboard;
}

function sharesState(overrides: Partial<ProjectSharesState> = {}): ProjectSharesState {
  return {
    shares: [],
    loading: false,
    loaded: true,
    error: false,
    reload: vi.fn(async () => {}),
    ...overrides,
  };
}

function flush() {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buttonWithText(container: ParentNode | null | undefined, text: string) {
  return Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])
    .find((button) => button.textContent === text);
}

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("Header share status", () => {
  function renderHeader({
    context = resolved,
    shares = sharesState(),
    signedIn = true,
    pending = null,
    onOpenShare = vi.fn(),
    onOpenCloud = vi.fn(),
  }: {
    context?: ProjectCloudContext;
    shares?: ProjectSharesState;
    signedIn?: boolean;
    pending?: PendingShare | null;
    onOpenShare?: () => void;
    onOpenCloud?: () => void;
  }) {
    act(() => root?.render(withTestLocalization(
      <CloudShareHeaderControl
        projectContext={context}
        shares={shares}
        signedIn={signedIn}
        pending={pending}
        onOpenShare={onOpenShare}
        onOpenCloud={onOpenCloud}
      />,
    )));
    return host.querySelector<HTMLButtonElement>(".desktop-titlebar-share");
  }

  const popover = () => document.querySelector<HTMLElement>(".desktop-share-popover");

  it("says the folder is only on this Mac and offers exactly one way forward", () => {
    const onOpenShare = vi.fn();
    const onOpenCloud = vi.fn();
    const button = renderHeader({
      context: { status: "local-only", projectId: null },
      shares: sharesState({ loaded: false }),
      signedIn: false,
      onOpenShare,
      onOpenCloud,
    });

    expect(button?.dataset.shareState).toBe("local");
    expect(button?.querySelector(".desktop-titlebar-share-label")?.textContent).toBe("Local");
    expect(button?.getAttribute("aria-label")).toContain("Only on this Mac");

    act(() => button?.click());
    const card = popover();
    expect(card?.getAttribute("role")).toBe("dialog");
    expect(card?.textContent).toContain("Only on this Mac · no Agent can read it");
    expect(Array.from(card?.querySelectorAll(".desktop-share-status-showcase-item") ?? [])
      .map((item) => item.textContent)).toEqual([
      "VViktor", "CClaude", "CChatGPT", "SSlack", "GGrok", "MMCP",
    ]);
    expect(card?.querySelectorAll("input, select, [role='radio']")).toHaveLength(0);
    const buttons = card?.querySelectorAll<HTMLButtonElement>("button") ?? [];
    expect(Array.from(buttons).map((candidate) => candidate.textContent)).toEqual(["Share with a cloud Agent"]);

    act(() => buttons[0]?.click());
    expect(onOpenShare).toHaveBeenCalledTimes(1);
    expect(onOpenCloud).not.toHaveBeenCalled();
    expect(popover()).toBeNull();
  });

  it("lists which Agents can read a shared project and whether they have used it", () => {
    const shares = buildProjectShares(
      [issuedEndpoint, { ...issuedEndpoint, id: "ep-docs", name: "Claude", accesses: [{ path: "docs", readonly: false }] }],
      dashboardReads({ "ep-docs": new Date().toISOString() }),
    );
    const button = renderHeader({ shares: sharesState({ shares }) });

    expect(button?.dataset.shareState).toBe("shared");
    expect(button?.querySelector(".desktop-titlebar-share-label")?.textContent).toBe("2 Agents");
    act(() => button?.click());
    const rows = Array.from(popover()?.querySelectorAll<HTMLElement>(".desktop-share-status-reader") ?? []);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("Viktor");
    expect(rows[0]?.textContent).toContain("Not used yet");
    expect(rows[1]?.textContent).toContain("docs");
    expect(rows[1]?.textContent).toContain("Read and write");
    expect(rows[1]?.querySelector("[data-live='true']")).not.toBeNull();
    expect(Array.from(popover()?.querySelectorAll("button") ?? []).map((candidate) => candidate.textContent))
      .toEqual(["Manage sharing"]);
  });

  it("keeps waiting for the first read after the dialog closes, then counts the reader", () => {
    const pending: PendingShare = { targetId: "viktor", endpointId: "ep-new", issuedAt: "2026-09-28T10:00:00Z" };
    const button = renderHeader({ shares: sharesState({ shares: buildProjectShares([issuedEndpoint], null) }), pending });

    expect(button?.dataset.shareState).toBe("waiting");
    expect(button?.querySelector(".desktop-titlebar-share-label")?.textContent).toBe("Waiting for Viktor…");
    act(() => button?.click());
    expect(popover()?.querySelector(".desktop-share-status-reader[data-waiting='true']")?.textContent)
      .toContain("Waiting for first read");

    const read = renderHeader({
      shares: sharesState({
        shares: buildProjectShares([issuedEndpoint], dashboardReads({ "ep-new": "2026-09-28T10:05:00Z" })),
      }),
      pending,
    });
    expect(read?.dataset.shareState).toBe("shared");
    expect(read?.querySelector(".desktop-titlebar-share-label")?.textContent).toBe("1 Agent");
  });

  it("does not claim nobody can read a published project before its shares load", () => {
    const button = renderHeader({ shares: sharesState({ loaded: false }) });
    expect(button?.dataset.shareState).toBe("resolving");
  });

  it("sends Cloud problems to the Cloud panel instead of the Share dialog", () => {
    const onOpenShare = vi.fn();
    const onOpenCloud = vi.fn();
    const button = renderHeader({
      context: { status: "not-authorized", projectId: "proj-1", message: { code: "workspace-unavailable" } },
      onOpenShare,
      onOpenCloud,
    });
    expect(button?.dataset.shareState).toBe("attention");
    act(() => button?.click());
    act(() => buttonWithText(popover(), "Fix in PuppyOne Cloud")?.click());
    expect(onOpenCloud).toHaveBeenCalledTimes(1);
    expect(onOpenShare).not.toHaveBeenCalled();
  });
});

describe("Share dialog", () => {
  function baseProps() {
    return {
      workspaceName: "Notes",
      initialTargetId: null,
      initialPath: "",
      session,
      apiBaseUrl: "https://cloud.example/api/v1",
      projectContext: resolved,
      publish: { loading: false, progress: null, error: null, start: vi.fn() },
      listTopLevelFolders: vi.fn(async () => [{ name: "docs", path: "docs" }]),
      onSessionChange: vi.fn(),
      onIssued: vi.fn(),
      onOpenCloud: vi.fn(),
      onClose: vi.fn(),
    };
  }
  const dialog = () => document.querySelector<HTMLElement>("[role='dialog']");

  it("walks who → how much → paste-ready URL and reports the issued share", async () => {
    api.createCloudMcpEndpoint.mockResolvedValue(issuedEndpoint);
    const props = baseProps();
    const render = (shares: ProjectSharesState) => act(() => root?.render(withTestLocalization(
      <ShareWizardDialog {...props} shares={shares} />,
    )));

    await render(sharesState());
    expect(dialog()?.textContent).toContain("Who should be able to read this?");
    expect(buttonWithText(dialog(), "Back")).toBeUndefined();
    expect(buttonWithText(dialog(), "Next")?.disabled).toBe(true);

    act(() => dialog()?.querySelector<HTMLButtonElement>("[data-share-target='viktor']")?.click());
    expect(dialog()?.textContent).toContain("Add custom MCP");
    act(() => buttonWithText(dialog(), "Next")?.click());
    await flush();

    expect(dialog()?.textContent).toContain("How much should it see?");
    expect(dialog()?.textContent).toContain("docs");
    act(() => buttonWithText(dialog(), "Let Viktor read this")?.click());
    await flush();

    expect(api.createCloudMcpEndpoint).toHaveBeenCalledTimes(1);
    expect(api.createCloudMcpEndpoint.mock.calls[0]?.[1]).toEqual({
      project_id: "proj-1",
      path: "",
      name: "Viktor",
      accesses: [{ path: "", json_path: "", readonly: true }],
    });
    expect(api.createCloudScope).not.toHaveBeenCalled();
    const values = Array.from(dialog()?.querySelectorAll<HTMLElement>(".desktop-share-copy-value") ?? [])
      .map((node) => node.textContent);
    expect(values[0]).toBe("https://cloud.example/api/v1/mcp/server/mcp_live_0123456789abcdef");
    expect(dialog()?.textContent).toContain("Waiting for Viktor to connect");
    expect(props.onIssued).toHaveBeenCalledWith({
      targetId: "viktor",
      endpointId: "ep-new",
      issuedAt: expect.any(String),
    });

    await render(sharesState({
      shares: buildProjectShares([issuedEndpoint], dashboardReads({ "ep-new": "2999-01-01T00:00:00Z" })),
    }));
    expect(dialog()?.textContent).toContain("Viktor connected");
  });

  it("opens on the current readers, revokes one, and adds another from there", async () => {
    api.deleteCloudMcpEndpoint.mockResolvedValue(undefined);
    const props = baseProps();
    const shares = sharesState({ shares: buildProjectShares([issuedEndpoint], null) });
    await act(async () => root?.render(withTestLocalization(<ShareWizardDialog {...props} shares={shares} />)));

    expect(stripBidiIsolation(dialog()?.querySelector("h2")?.textContent)).toBe("Who can read Notes");
    expect(dialog()?.querySelector(".desktop-share-stepper")).toBeNull();
    expect(dialog()?.textContent).toContain("1 Agent can read this project.");
    const row = dialog()?.querySelector<HTMLElement>(".desktop-share-readers-row");
    expect(row?.textContent).toContain("Viktor");
    expect(buttonWithText(row, "Copy URL")).toBeDefined();

    act(() => buttonWithText(row, "Revoke")?.click());
    expect(api.deleteCloudMcpEndpoint).not.toHaveBeenCalled();
    await act(async () => buttonWithText(row, "Revoke access")?.click());
    await flush();
    expect(api.deleteCloudMcpEndpoint).toHaveBeenCalledWith(session, "ep-new", props.onSessionChange, props.apiBaseUrl);
    expect(shares.reload).toHaveBeenCalledTimes(1);

    act(() => buttonWithText(dialog(), "Share with another Agent")?.click());
    expect(dialog()?.textContent).toContain("Who should be able to read this?");
    act(() => buttonWithText(dialog(), "Back")?.click());
    expect(dialog()?.querySelector(".desktop-share-readers-row")).not.toBeNull();
  });

  it("goes straight to the folder when started from a folder, even with readers", async () => {
    const props = { ...baseProps(), initialPath: "docs" };
    await act(async () => root?.render(withTestLocalization(
      <ShareWizardDialog {...props} shares={sharesState({ shares: buildProjectShares([issuedEndpoint], null) })} />,
    )));
    expect(dialog()?.textContent).toContain("Who should be able to read this?");
  });

  it("reuses an identical share instead of minting a second key", async () => {
    const { api_key: _omitted, ...listed } = issuedEndpoint;
    await act(async () => root?.render(withTestLocalization(
      <ShareWizardDialog
        {...baseProps()}
        initialTargetId="viktor"
        shares={sharesState({ shares: buildProjectShares([listed], null) })}
      />,
    )));
    expect(dialog()?.textContent).toContain("How much should it see?");
    act(() => buttonWithText(dialog(), "Let Viktor read this")?.click());
    await flush();
    expect(api.createCloudMcpEndpoint).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain("This key was only shown when it was first issued.");
    const values = Array.from(dialog()?.querySelectorAll<HTMLElement>(".desktop-share-copy-value") ?? [])
      .map((node) => node.textContent);
    expect(values).toContain("mcp_…cdef");
    expect(values.join(" ")).not.toContain("mcp_live_");
  });

  it("publishes inline when the project is still local", async () => {
    api.listCloudOrganizations.mockResolvedValue([{ id: "org-a", name: "Organization A", slug: "organization-a", plan: "plus" }]);
    const start = vi.fn();
    await act(async () => root?.render(withTestLocalization(
      <ShareWizardDialog
        {...baseProps()}
        initialTargetId="viktor"
        projectContext={{ status: "local-only", projectId: null }}
        publish={{ loading: false, progress: null, error: null, start }}
        shares={sharesState({ loaded: false })}
        listTopLevelFolders={async () => []}
      />,
    )));
    act(() => buttonWithText(dialog(), "Let Viktor read this")?.click());
    await flush();
    await flush();
    expect(stripBidiIsolation(dialog()?.textContent)).toContain("Making Notes reachable for Viktor");
    expect(start).toHaveBeenCalledWith("org-a", { navigateToCloud: false });
  });
});
