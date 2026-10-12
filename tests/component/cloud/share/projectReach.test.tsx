/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopCloudMcpEndpoint, DesktopCloudSession } from "../../../../src/lib/cloudApi";
import type { ProjectCloudContext } from "../../../../src/features/cloud/project/context/projectCloudContext";
import { projectRootTarget } from "../../../../src/features/cloud/repositoryTarget";
import { initializeDesktopPreferences, desktopPreferencesStore } from "../../../../src/preferencesStore";
import { useProjectReachExperience } from "../../../../src/features/project-reach";
import { gitStatus } from "../../../support/source-control/gitFixtures";
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
  ProjectReachDialog,
  ReadersList,
  ShareWizardDialog,
  useProjectShareRevoke,
  type ProjectSharesState,
} from "../../../../src/features/cloud/share";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT_ID = "01926faa-7ed1-7000-a000-000000000001";

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
  projectId: PROJECT_ID,
  target: projectRootTarget(PROJECT_ID),
};

const issuedEndpoint: DesktopCloudMcpEndpoint = {
  id: "ep-new",
  project_id: PROJECT_ID,
  path: "docs",
  name: "Claude",
  api_key: "mcp_live_0123456789abcdef",
  api_key_hint: "mcp_…cdef",
  status: "active",
  accesses: [{ path: "docs", json_path: "", readonly: true }],
  created_at: "2026-10-01T10:00:00Z",
};

const bridge = vi.hoisted(() => ({
  getGitStatus: vi.fn(),
  getPublishScope: vi.fn(),
  initGitRepository: vi.fn(),
  stageAllGitChanges: vi.fn(),
  commitGit: vi.fn(),
  createGitBranch: vi.fn(),
}));

function sharesState(overrides: Partial<ProjectSharesState> = {}): ProjectSharesState {
  return { shares: [], loading: false, loaded: true, error: false, reload: vi.fn(async () => {}), ...overrides };
}

function baseProps() {
  return {
    workspaceName: "Notes",
    workspacePath: "/fixture/Notes",
    initialTargetId: null,
    initialPath: "docs",
    session: null as DesktopCloudSession | null,
    apiBaseUrl: session.api_base_url,
    projectContext: resolved,
    publish: { loading: false, progress: null, error: null, start: vi.fn() },
    shares: sharesState(),
    listTopLevelFolders: vi.fn(async () => [{ name: "docs", path: "docs" }, { name: "media", path: "media" }]),
    onSessionChange: vi.fn(),
    onIssued: vi.fn(),
    onOpenCloud: vi.fn(),
    onClose: vi.fn(),
  };
}

function flush() {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const dialog = () => document.querySelector<HTMLElement>("[role='dialog']");
const text = () => stripBidiIsolation(dialog()?.textContent);
function button(label: string, container: ParentNode | null | undefined = dialog()) {
  return Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])
    .find((candidate) => candidate.textContent?.trim() === label);
}
function radio(label: string) {
  return Array.from(dialog()?.querySelectorAll<HTMLElement>("[role='radio']") ?? [])
    .find((candidate) => stripBidiIsolation(candidate.textContent).includes(label));
}
function currentStep() {
  return dialog()?.querySelector<HTMLElement>("[aria-current='step'] strong")?.textContent ?? null;
}

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  initializeDesktopPreferences();
  bridge.getGitStatus.mockResolvedValue(gitStatus());
  bridge.getPublishScope.mockResolvedValue({ files: 12, bytes: 2048, truncated: false });
  window.puppyoneDesktop = bridge as unknown as Window["puppyoneDesktop"];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("one screen for inviting a person", () => {
  it("states the destination, the narrow default, what it amounts to, and one action", async () => {
    const props = baseProps();
    await act(async () => root?.render(withTestLocalization(<ProjectReachDialog {...props} />)));
    await flush();

    expect(stripBidiIsolation(dialog()?.querySelector("h2")?.textContent)).toBe("Invite a person to Notes");
    expect(dialog()?.querySelector(".desktop-share-stepper")).toBeNull();
    expect(text()).toContain("Anyone you send the link to");
    expect(radio("Only docs")?.getAttribute("aria-checked")).toBe("true");
    expect(radio("Whole project")?.getAttribute("aria-checked")).toBe("false");
    expect(bridge.getPublishScope).toHaveBeenCalledWith({ rootPath: "/fixture/Notes", path: "docs" });
    expect(text()).toContain("12 files · 2 KB · anything your .gitignore excludes stays out");
    expect(text()).toContain("They see the version you last saved.");
    // A link is read under the reader's own account, so there is nothing to choose.
    expect(text()).not.toContain("What can it do?");

    const primary = button("Invite a person");
    expect(primary?.className).toContain("primary");
    expect(primary?.disabled).toBe(false);
    expect(button("Cancel")?.className).not.toContain("primary");
    expect(dialog()?.querySelectorAll(".desktop-dialog-button.primary")).toHaveLength(1);
  });

  it("re-measures when the choice widens to the whole project", async () => {
    await act(async () => root?.render(withTestLocalization(<ProjectReachDialog {...baseProps()} />)));
    await flush();
    bridge.getPublishScope.mockResolvedValue({ files: 240, bytes: 1024 * 1024 * 3, truncated: true });

    await act(async () => radio("Whole project")?.click());
    await flush();

    expect(bridge.getPublishScope).toHaveBeenLastCalledWith({ rootPath: "/fixture/Notes", path: "" });
    expect(text()).toContain("At least 240 files · 3 MB");
  });
});

describe("the same skeleton for connecting an agent", () => {
  it("states which candidates are awake, promises review, and waits for a choice", async () => {
    await act(async () => root?.render(withTestLocalization(<ProjectReachDialog {...baseProps()} />)));
    await flush();

    await act(async () => button("Connect an agent instead")?.click());
    await flush();

    expect(stripBidiIsolation(dialog()?.querySelector("h2")?.textContent)).toBe("Connect an agent to Notes");
    expect(text()).toContain("Which agent?");
    expect(text()).toContain("Awake all the time");
    expect(text()).toContain("Awake while in use");
    expect(text()).toContain("Decided by your client");
    expect(text()).toContain("comes back as changes waiting for your review");
    expect(button("Connect")?.disabled).toBe(true);

    await act(async () => dialog()?.querySelector<HTMLButtonElement>("[data-share-target='claude']")?.click());
    await flush();

    expect(text()).toContain("What can it do?");
    expect(radio("Read only")?.getAttribute("aria-checked")).toBe("true");
    expect(radio("Read and write")?.getAttribute("aria-checked")).toBe("false");
    expect(button("Connect Claude")?.disabled).toBe(false);
  });
});

describe("the account as a step rather than a door", () => {
  it("finishes the work that needs nobody first and creates nothing in Cloud until it is signed", async () => {
    bridge.getGitStatus.mockResolvedValue(gitStatus({ isRepo: false, headCommitId: null, totalCommits: 0, branch: null }));
    bridge.initGitRepository.mockResolvedValue(gitStatus({ headCommitId: null, totalCommits: 0, branch: null }));
    bridge.stageAllGitChanges.mockResolvedValue(gitStatus({ headCommitId: null, totalCommits: 0, branch: null }));
    // No Git identity yet: the snapshot waits for the account instead of failing.
    bridge.commitGit.mockRejectedValue(new Error("no identity"));
    const props = { ...baseProps(), projectContext: { status: "local-only" as const, projectId: null } };

    await act(async () => root?.render(withTestLocalization(<ProjectReachDialog {...props} />)));
    await flush();
    await act(async () => button("Invite a person")?.click());
    await flush();

    expect(bridge.initGitRepository).toHaveBeenCalledWith({ rootPath: "/fixture/Notes" });
    expect(currentStep()).toBe("Account");
    expect(text()).toContain("Nothing is created in Cloud until you sign in");
    expect(dialog()?.querySelector("[role='alert']")).toBeNull();
    expect(props.publish.start).not.toHaveBeenCalled();
    expect(api.createCloudMcpEndpoint).not.toHaveBeenCalled();
  });

  it("carries on to the issued reach once the account arrives", async () => {
    api.createCloudMcpEndpoint.mockResolvedValue(issuedEndpoint);
    api.listCloudScopes.mockResolvedValue([{ path: "docs" }]);
    const props = baseProps();
    const render = (next: Partial<ReturnType<typeof baseProps>>) => act(async () => root?.render(
      withTestLocalization(<ProjectReachDialog {...props} {...next} />),
    ));

    await render({});
    await flush();
    await act(async () => button("Connect an agent instead")?.click());
    await act(async () => dialog()?.querySelector<HTMLButtonElement>("[data-share-target='claude']")?.click());
    await act(async () => button("Connect Claude")?.click());
    await flush();
    expect(currentStep()).toBe("Account");

    await render({ session });
    await flush();
    await flush();

    expect(api.createCloudMcpEndpoint).toHaveBeenCalledTimes(1);
    expect(api.createCloudMcpEndpoint.mock.calls[0]?.[1]).toEqual({
      project_id: PROJECT_ID,
      path: "docs",
      name: "Claude",
      accesses: [{ path: "docs", json_path: "", readonly: true }],
    });
    expect(api.createCloudScope).not.toHaveBeenCalled();
    expect(props.onIssued).toHaveBeenCalledWith({
      targetId: "claude",
      endpointId: "ep-new",
      issuedAt: expect.any(String),
    });
    expect(text()).toContain("Waiting for Claude to connect");
    const values = Array.from(dialog()?.querySelectorAll<HTMLElement>(".desktop-share-copy-value") ?? [])
      .map((node) => node.textContent);
    expect(values[0]).toBe("https://cloud.example/api/v1/mcp/server/mcp_live_0123456789abcdef");
  });
});

describe("who can reach the project", () => {
  it("lists the readers as facts and stops one from the same screen", async () => {
    api.deleteCloudMcpEndpoint.mockResolvedValue(undefined);
    const shares = sharesState({ shares: buildProjectShares([issuedEndpoint], null) });
    const props = { ...baseProps(), session, shares };
    await act(async () => root?.render(withTestLocalization(<ProjectReachDialog {...props} />)));
    await flush();

    const row = dialog()?.querySelector<HTMLElement>(".desktop-readers-row");
    expect(row?.textContent).toContain("Claude");
    expect(row?.textContent).toContain("docs");
    expect(row?.textContent).toContain("Can read");
    expect(row?.textContent).toContain("Has not read anything yet");

    await act(async () => button("Stop", row)?.click());
    expect(api.deleteCloudMcpEndpoint).not.toHaveBeenCalled();
    expect(stripBidiIsolation(row?.textContent)).toContain("Claude stops reading immediately.");

    await act(async () => button("Stop", dialog()?.querySelector(".desktop-readers-confirm"))?.click());
    await flush();

    expect(api.deleteCloudMcpEndpoint)
      .toHaveBeenCalledWith(session, "ep-new", props.onSessionChange, props.apiBaseUrl);
    expect(shares.reload).toHaveBeenCalledTimes(1);
  });

  it("says nothing about readers while no account can see them", async () => {
    await act(async () => root?.render(withTestLocalization(<ProjectReachDialog {...baseProps()} />)));
    await flush();

    expect(dialog()?.querySelector(".desktop-reach-readers")).toBeNull();
  });
});

describe("the reach list on its own", () => {
  /** The shape any surface mounts it in: the list, and the hook that stops one. */
  function ReachPanel({ shares }: { shares: ProjectSharesState }) {
    const revoke = useProjectShareRevoke({
      session,
      apiBaseUrl: session.api_base_url,
      shares,
      onSessionChange: () => {},
    });
    return <ReadersList readers={shares.shares} revoke={revoke} />;
  }

  it("works outside the dialog, so one revocation serves every surface", async () => {
    api.deleteCloudMcpEndpoint.mockResolvedValue(undefined);
    const shares = sharesState({ shares: buildProjectShares([issuedEndpoint], null) });
    await act(async () => root?.render(withTestLocalization(<ReachPanel shares={shares} />)));

    const list = host.querySelector("ul[aria-label='Who can reach this project']");
    expect(list).not.toBeNull();

    await act(async () => button("Stop", host)?.click());
    await act(async () => button("Stop", host.querySelector(".desktop-readers-confirm"))?.click());
    await flush();

    expect(api.deleteCloudMcpEndpoint).toHaveBeenCalledWith(session, "ep-new", expect.any(Function), session.api_base_url);
    expect(shares.reload).toHaveBeenCalledTimes(1);
  });

  it("says so plainly when nobody reaches the project", async () => {
    await act(async () => root?.render(withTestLocalization(<ReachPanel shares={sharesState()} />)));

    expect(host.textContent).toBe("Nobody can reach this project yet.");
  });
});

describe("the switch at the share entry", () => {
  /** The shape of the fork in `src/App.tsx`: one decision, two whole paths. */
  function ShareSurface(props: ReturnType<typeof baseProps>) {
    return useProjectReachExperience()
      ? <ProjectReachDialog {...props} />
      : <ShareWizardDialog {...props} />;
  }

  it("keeps the step wizard until project reach is turned on", async () => {
    await act(async () => root?.render(withTestLocalization(<ShareSurface {...baseProps()} />)));
    await flush();

    expect(dialog()?.querySelector(".desktop-share-stepper")).not.toBeNull();
    expect(text()).toContain("Who should be able to read this?");
    expect(text()).not.toContain("They see the version you last saved.");

    act(() => desktopPreferencesStore.getState().setExperimentalSettings(
      (current) => ({ ...current, enableProjectReach: true }),
    ));
    await flush();

    expect(dialog()?.querySelector(".desktop-share-stepper")).toBeNull();
    expect(text()).toContain("They see the version you last saved.");
  });
});
