/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@puppyone/shared-ui";
import type { CloudAuthState } from "../../../../src/features/cloud/auth";
import { CloudServiceSidebar } from "../../../../src/features/cloud/CloudServiceSidebar";
import { CloudRepositoryOverview } from "../../../../src/features/cloud/sections/overview";
import {
  buildProjectShares,
  CloudShareHome,
  CloudShareProvider,
  SHARE_TARGETS,
  type CloudShareActions,
  type ProjectSharesState,
} from "../../../../src/features/cloud/share";
import { FeatureFlagsProvider } from "../../../../src/features/flags";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { projectRootTarget } from "../../../../src/features/cloud/repositoryTarget";
import { stripBidiIsolation, withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const WORKSPACE = { id: "workspace-1", name: "Atlas", path: "/work/atlas", status: "protected" } satisfies Workspace;
const RESOLVED_CONTEXT = {
  status: "resolved" as const,
  projectId: "proj-1",
  target: projectRootTarget("proj-1"),
};

const session: DesktopCloudSession = {
  expires_in: 3600,
  expires_at: 4_102_444_800,
  user_id: "user-1",
  user_email: "dev@example.com",
  api_base_url: "https://cloud.example/api/v1",
  session_generation: "generation-1",
  status: "authenticated",
};

function sharesState(overrides: Partial<ProjectSharesState> = {}): ProjectSharesState {
  return { shares: [], loading: false, loaded: true, error: false, reload: vi.fn(async () => {}), ...overrides };
}

function shareActions(overrides: Partial<CloudShareActions> = {}): CloudShareActions {
  return { shares: sharesState(), signedIn: true, pending: null, openShare: vi.fn(), ...overrides };
}

function overview() {
  return (
    <CloudRepositoryOverview
      variant="home"
      workspace={WORKSPACE}
      project={{ id: "proj-1", name: "Atlas" }}
      dashboard={{
        project: { id: "proj-1", name: "Atlas" },
        nodes: { total: 12, folders: 2, files: 10, storage_bytes: 2048 },
        connections: [],
        tools: [],
      } as never}
      tree={{ path: "", entries: [] }}
      history={null}
      scopes={[]}
      connectors={[]}
      mcpEndpoints={[]}
      identity={null}
      loading={false}
      onSelectSection={vi.fn()}
      onRefresh={vi.fn(async () => undefined)}
    />
  );
}

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("Cloud Share page", () => {
  it("keeps the Cloud Homepage stable while the Share experiment is on", () => {
    act(() => root?.render(withTestLocalization(
      <CloudShareProvider value={shareActions()}>{overview()}</CloudShareProvider>,
    )));
    expect(host.querySelector(".desktop-share-page")).toBeNull();
    expect(host.querySelector(".desktop-cloud-overview-landing-copy h1")?.textContent).toBe("Atlas");
    expect(host.querySelector(".desktop-cloud-overview-actions")).not.toBeNull();
  });

  it("shows sharing status and opens a focused flow from each destination", () => {
    const actions = shareActions();
    act(() => root?.render(withTestLocalization(
      <CloudShareHome projectName="Atlas" projectContext={RESOLVED_CONTEXT} share={actions} />,
    )));

    const page = host.querySelector<HTMLElement>(".desktop-share-page");
    expect(page).not.toBeNull();
    expect(page?.querySelector("h1")?.textContent).toBe("Share");
    expect(stripBidiIsolation(page?.querySelector(".desktop-share-page-header p")?.textContent)).toBe("Who can read Atlas");
    expect(page?.querySelector(".desktop-share-status--page")?.textContent).toContain("Synced · no Agent can read it yet");

    const targets = page?.querySelectorAll<HTMLButtonElement>(".desktop-share-page-target");
    expect(targets).toHaveLength(SHARE_TARGETS.length);
    expect(page?.querySelector("[data-share-target='viktor'] .po-agent-brand-image")).not.toBeNull();
    act(() => page?.querySelector<HTMLButtonElement>("[data-share-target='viktor']")?.click());
    expect(actions.openShare).toHaveBeenCalledWith("viktor");
  });

  it("keeps current readers visible above the destination list", () => {
    const shares = buildProjectShares([{
      id: "ep-1",
      project_id: "proj-1",
      path: "",
      name: "Viktor",
      status: "active",
      accesses: [{ path: "docs", readonly: true }],
    }], null);
    const actions = shareActions({ shares: sharesState({ shares }) });
    act(() => root?.render(withTestLocalization(
      <CloudShareHome projectName="Atlas" projectContext={RESOLVED_CONTEXT} share={actions} />,
    )));
    const card = host.querySelector<HTMLElement>(".desktop-share-status--page");
    expect(card?.dataset.shareState).toBe("shared");
    expect(card?.textContent).toContain("Synced · 1 Agent can read it");
    expect(card?.textContent).toContain("Viktor");
    expect(card?.textContent).toContain("docs");
    expect(card?.querySelector(".desktop-share-status-primary")?.textContent).toBe("Manage sharing");
  });
});

describe("Cloud sidebar under the Share experiment", () => {
  const authState: CloudAuthState = { status: "signed-in", apiBaseUrl: session.api_base_url, session };
  const labels = () => Array.from(host.querySelectorAll<HTMLElement>(".po-sidebar-row"))
    .map((row) => row.textContent?.trim());
  const sidebar = (activeSection: "contents" | "share") => (
    <FeatureFlagsProvider value={{ cloudWorkspace: true, cloudBilling: false, assetLibraryHome: false }}>
      <CloudServiceSidebar
        cloudAuthState={authState}
        activeSection={activeSection}
        automationEnabled={false}
        projectAvailable
        onSelectSection={vi.fn()}
      />
    </FeatureFlagsProvider>
  );

  it("adds Share as the second entry only when the experiment is on", () => {
    act(() => root?.render(withTestLocalization(sidebar("contents"))));
    expect(labels()).toEqual(["Homepage", "Other Agents", "Access via CLI", "Team"]);

    act(() => root?.render(withTestLocalization(
      <CloudShareProvider value={shareActions()}>{sidebar("share")}</CloudShareProvider>,
    )));
    expect(labels()).toEqual(["Homepage", "Share", "Other Agents", "Access via CLI", "Team"]);
    const active = Array.from(host.querySelectorAll<HTMLElement>(".po-sidebar-row[aria-current='page']"));
    expect(active.map((row) => row.textContent?.trim())).toEqual(["Share"]);
  });
});
