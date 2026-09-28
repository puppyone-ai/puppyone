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
  CloudShareProvider,
  type CloudShareActions,
  type ProjectSharesState,
} from "../../../../src/features/cloud/share";
import { FeatureFlagsProvider } from "../../../../src/features/flags";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { stripBidiIsolation, withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const WORKSPACE = { id: "workspace-1", name: "Atlas", path: "/work/atlas", status: "protected" } satisfies Workspace;

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

function overview(variant: "home" | "project", onSelectSection = vi.fn()) {
  return (
    <CloudRepositoryOverview
      variant={variant}
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
      onSelectSection={onSelectSection}
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

describe("Share-first Cloud Homepage", () => {
  it("keeps the classic overview when the experiment is off", () => {
    act(() => root?.render(withTestLocalization(overview("home"))));
    expect(host.querySelector(".desktop-share-home")).toBeNull();
    expect(host.querySelector(".desktop-cloud-overview-landing-copy h1")?.textContent).toBe("Atlas");
    expect(host.querySelector(".desktop-cloud-overview-actions")).not.toBeNull();
  });

  it("opens with 'who should read this' and demotes identity to a second-act CTA", () => {
    const openShare = vi.fn();
    const onSelectSection = vi.fn();
    const actions: CloudShareActions = { shares: sharesState(), openShare };
    act(() => root?.render(withTestLocalization(
      <CloudShareProvider value={actions}>{overview("home", onSelectSection)}</CloudShareProvider>,
    )));

    const home = host.querySelector<HTMLElement>(".desktop-share-home");
    expect(home).not.toBeNull();
    expect(host.querySelector(".desktop-cloud-overview-landing-copy h1")).toBeNull();
    expect(host.querySelector(".desktop-cloud-overview-actions")).toBeNull();
    expect(host.querySelector(".desktop-cloud-overview-dashboard")).toBeNull();
    expect(stripBidiIsolation(home?.querySelector("h2")?.textContent)).toBe("Share Atlas with…");

    const cards = Array.from(home?.querySelectorAll<HTMLButtonElement>(".desktop-share-home-card") ?? []);
    expect(cards.map((card) => card.dataset.shareTarget)).toEqual([
      "viktor", "claude", "chatgpt", "slack-bot", "grok", "person", "mcp",
    ]);
    expect(cards[0]?.textContent).toContain("Add custom MCP");
    act(() => cards[0]?.click());
    expect(openShare).toHaveBeenCalledWith("viktor");

    const secondary = Array.from(home?.querySelectorAll<HTMLButtonElement>(".desktop-share-home-secondary-cta") ?? []);
    expect(secondary[0]?.textContent).toContain("Atlas");
    expect(secondary[0]?.textContent).toContain("10 files");
    expect(secondary[0]?.textContent).toContain("2 KB");
    act(() => secondary[0]?.click());
    expect(onSelectSection).toHaveBeenCalledWith("project");
    act(() => secondary[1]?.click());
    expect(onSelectSection).toHaveBeenCalledWith("history");
  });

  it("lists who can already read the project on the first act", () => {
    const shares = buildProjectShares([{
      id: "ep-1",
      project_id: "proj-1",
      path: "",
      name: "Viktor",
      status: "active",
      accesses: [{ path: "docs", readonly: true }],
    }], null);
    act(() => root?.render(withTestLocalization(
      <CloudShareProvider value={{ shares: sharesState({ shares }), openShare: vi.fn() }}>
        {overview("home")}
      </CloudShareProvider>,
    )));
    const existing = host.querySelector<HTMLElement>(".desktop-share-home-existing");
    expect(existing?.textContent).toContain("Who can read this");
    expect(existing?.textContent).toContain("Viktor");
    expect(existing?.textContent).toContain("docs");
    expect(existing?.textContent).toContain("Not used yet");
  });

  it("shows identity, storage, and files on the Project section without the job cards", () => {
    act(() => root?.render(withTestLocalization(
      <CloudShareProvider value={{ shares: sharesState(), openShare: vi.fn() }}>{overview("project")}</CloudShareProvider>,
    )));
    expect(host.querySelector(".desktop-share-home")).toBeNull();
    expect(host.querySelector(".desktop-cloud-overview-landing-copy h1")?.textContent).toBe("Atlas");
    expect(host.querySelector(".desktop-cloud-overview-project-storage")).not.toBeNull();
    expect(host.querySelector(".desktop-cloud-overview-dashboard")).not.toBeNull();
    expect(host.querySelector(".desktop-cloud-overview-actions")).toBeNull();
  });
});

describe("Cloud sidebar under the Share experiment", () => {
  const authState: CloudAuthState = { status: "signed-in", apiBaseUrl: session.api_base_url, session };
  const labels = () => Array.from(host.querySelectorAll<HTMLElement>(".po-sidebar-row"))
    .map((row) => row.textContent?.trim());
  const sidebar = (activeSection: "contents" | "project") => (
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

  it("adds Project as the second entry only when the experiment is on", () => {
    act(() => root?.render(withTestLocalization(sidebar("contents"))));
    expect(labels()).toEqual(["Homepage", "Other Agents", "Access via CLI", "Team"]);

    act(() => root?.render(withTestLocalization(
      <CloudShareProvider value={{ shares: sharesState(), openShare: vi.fn() }}>{sidebar("project")}</CloudShareProvider>,
    )));
    expect(labels()).toEqual(["Homepage", "Project", "Other Agents", "Access via CLI", "Team"]);
    const active = Array.from(host.querySelectorAll<HTMLElement>(".po-sidebar-row[aria-current='page']"));
    expect(active.map((row) => row.textContent?.trim())).toEqual(["Project"]);
  });
});
