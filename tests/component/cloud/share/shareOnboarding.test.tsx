/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopCloudMcpEndpoint, DesktopCloudSession } from "../../../../src/lib/cloudApi";
import type { ProjectCloudContext } from "../../../../src/features/cloud/project/context/projectCloudContext";
import { projectRootTarget } from "../../../../src/features/cloud/repositoryTarget";
import { stripBidiIsolation, withTestLocalization } from "../../../support/react/localization";

const api = vi.hoisted(() => ({
  createCloudMcpEndpoint: vi.fn(),
  createCloudScope: vi.fn(),
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

describe("Header share control", () => {
  it("shows Local for an unpublished project and offers every destination", () => {
    const onShare = vi.fn();
    act(() => root?.render(withTestLocalization(
      <CloudShareHeaderControl
        projectContext={{ status: "local-only", projectId: null }}
        shares={sharesState({ loaded: false })}
        onShare={onShare}
        onOpenCloud={vi.fn()}
      />,
    )));

    const button = host.querySelector<HTMLButtonElement>(".desktop-titlebar-share");
    expect(button?.dataset.shareState).toBe("local");
    expect(button?.getAttribute("aria-label")).toContain("Local only");

    act(() => button?.click());
    const menu = document.querySelector<HTMLElement>(".desktop-share-menu");
    expect(menu?.textContent).toContain("Share with…");
    const viktor = menu?.querySelector<HTMLButtonElement>("[data-share-target='viktor']");
    expect(viktor).not.toBeNull();
    act(() => viktor?.click());
    expect(onShare).toHaveBeenCalledWith("viktor");
  });

  it("lists who can read a shared project and whether they have used it", () => {
    const shares = buildProjectShares(
      [issuedEndpoint, { ...issuedEndpoint, id: "ep-docs", name: "Claude", accesses: [{ path: "docs", readonly: false }] }],
      {
        project: { id: "proj-1", name: "Notes" },
        nodes: { total: 0, folders: 0, files: 0 },
        connections: [{ id: "ep-docs", provider: "mcp", status: "active", last_synced_at: new Date().toISOString() }],
        tools: [],
      } as never,
    );
    act(() => root?.render(withTestLocalization(
      <CloudShareHeaderControl
        projectContext={resolved}
        shares={sharesState({ shares })}
        onShare={vi.fn()}
        onOpenCloud={vi.fn()}
      />,
    )));

    const button = host.querySelector<HTMLButtonElement>(".desktop-titlebar-share");
    expect(button?.dataset.shareState).toBe("shared");
    act(() => button?.click());
    const rows = Array.from(document.querySelectorAll<HTMLElement>(".desktop-share-menu-row"));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("Viktor");
    expect(rows[0]?.textContent).toContain("Not used yet");
    expect(rows[1]?.textContent).toContain("docs");
    expect(rows[1]?.textContent).toContain("Read and write");
    expect(rows[1]?.querySelector("[data-live='true']")).not.toBeNull();
  });
});

describe("Share wizard", () => {
  it("walks who → how much → paste-ready URL and waits for the receipt", async () => {
    api.createCloudMcpEndpoint.mockResolvedValue(issuedEndpoint);
    const onWaitingChange = vi.fn();
    const listTopLevelFolders = vi.fn(async () => [{ name: "docs", path: "docs" }]);
    const props = {
      workspaceName: "Notes",
      initialTargetId: null,
      initialPath: "",
      session,
      apiBaseUrl: "https://cloud.example/api/v1",
      projectContext: resolved,
      publish: { loading: false, progress: null, error: null, start: vi.fn() },
      listTopLevelFolders,
      onSessionChange: vi.fn(),
      onWaitingChange,
      onOpenCloud: vi.fn(),
      onClose: vi.fn(),
    };
    const render = (shares: ProjectSharesState) => act(() => root?.render(withTestLocalization(
      <ShareWizardDialog {...props} shares={shares} />,
    )));

    await render(sharesState());
    const dialog = () => document.querySelector<HTMLElement>("[role='dialog']");
    expect(dialog()?.textContent).toContain("Who should be able to read this?");
    const next = () => Array.from(dialog()?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent === "Next");
    expect(next()?.disabled).toBe(true);

    act(() => dialog()?.querySelector<HTMLButtonElement>("[data-share-target='viktor']")?.click());
    expect(dialog()?.textContent).toContain("Add custom MCP");
    act(() => next()?.click());
    await flush();

    expect(dialog()?.textContent).toContain("How much should it see?");
    expect(dialog()?.textContent).toContain("docs");
    const connect = Array.from(dialog()?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent === "Let Viktor read this");
    act(() => connect?.click());
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
    expect(onWaitingChange).toHaveBeenLastCalledWith(true);

    await render(sharesState({
      shares: buildProjectShares([issuedEndpoint], {
        project: { id: "proj-1", name: "Notes" },
        nodes: { total: 0, folders: 0, files: 0 },
        connections: [{ id: "ep-new", provider: "mcp", status: "active", last_synced_at: "2999-01-01T00:00:00Z" }],
        tools: [],
      } as never),
    }));
    expect(dialog()?.textContent).toContain("Viktor connected");
    expect(onWaitingChange).toHaveBeenLastCalledWith(false);
  });

  it("reuses an identical share instead of minting a second key", async () => {
    const { api_key: _omitted, ...listed } = issuedEndpoint;
    const existing = buildProjectShares([listed], null);
    await act(async () => root?.render(withTestLocalization(
      <ShareWizardDialog
        workspaceName="Notes"
        initialTargetId="viktor"
        initialPath=""
        session={session}
        apiBaseUrl="https://cloud.example/api/v1"
        projectContext={resolved}
        publish={{ loading: false, progress: null, error: null, start: vi.fn() }}
        shares={sharesState({ shares: existing })}
        listTopLevelFolders={async () => []}
        onSessionChange={vi.fn()}
        onWaitingChange={vi.fn()}
        onOpenCloud={vi.fn()}
        onClose={vi.fn()}
      />,
    )));
    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    expect(dialog?.textContent).toContain("How much should it see?");
    const connect = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent === "Let Viktor read this");
    act(() => connect?.click());
    await flush();
    expect(api.createCloudMcpEndpoint).not.toHaveBeenCalled();
    expect(dialog?.textContent).toContain("This key was only shown when it was first issued.");
    const values = Array.from(dialog?.querySelectorAll<HTMLElement>(".desktop-share-copy-value") ?? [])
      .map((node) => node.textContent);
    expect(values).toContain("mcp_…cdef");
    expect(values.join(" ")).not.toContain("mcp_live_");
  });

  it("publishes inline when the project is still local", async () => {
    api.listCloudOrganizations.mockResolvedValue([{ id: "org-a", name: "Organization A", slug: "organization-a", plan: "plus" }]);
    const start = vi.fn();
    await act(async () => root?.render(withTestLocalization(
      <ShareWizardDialog
        workspaceName="Notes"
        initialTargetId="viktor"
        initialPath=""
        session={session}
        apiBaseUrl="https://cloud.example/api/v1"
        projectContext={{ status: "local-only", projectId: null }}
        publish={{ loading: false, progress: null, error: null, start }}
        shares={sharesState({ loaded: false })}
        listTopLevelFolders={async () => []}
        onSessionChange={vi.fn()}
        onWaitingChange={vi.fn()}
        onOpenCloud={vi.fn()}
        onClose={vi.fn()}
      />,
    )));
    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    const connect = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent === "Let Viktor read this");
    act(() => connect?.click());
    await flush();
    await flush();
    expect(stripBidiIsolation(dialog?.textContent)).toContain("Making Notes reachable for Viktor");
    expect(start).toHaveBeenCalledWith("org-a", { navigateToCloud: false });
  });
});
