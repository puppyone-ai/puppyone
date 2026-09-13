import { gitStatus as createGitStatus } from "../../../support/source-control/gitFixtures";
/**
 * @vitest-environment happy-dom
 */
import type { Workspace } from "@puppyone/shared-ui";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectCloudContext } from "../../../../src/features/cloud/project/context";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import type { GitStatusSnapshot } from "../../../../src/types/electron";

const cloudApi = vi.hoisted(() => ({
  getCloudRepositoryContext: vi.fn(),
}));

vi.mock("../../../../src/lib/cloudApi", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/lib/cloudApi")>("../../../../src/lib/cloudApi");
  return { ...actual, ...cloudApi };
});

import { useCurrentRepositoryCloudContext } from "../../../../src/features/cloud/project/context";
import { shouldBlockWorkspaceCloudResolution } from "../../../../src/features/cloud/workspace/workspaceCloudResolutionKey";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const session = {
  user_id: "user-1",
  user_email: "dev@example.com",
  api_base_url: "https://cloud.example/api/v1",
  session_generation: "generation-1",
  status: "authenticated",
  expires_at: 4_102_444_800,
  expires_in: 3_600,
} satisfies DesktopCloudSession;

const workspace: Workspace = {
  id: "local:notes",
  name: "Notes",
  path: "/tmp/notes",
  workspaceInstanceId: "local-only-instance",
  status: "protected",
};

function gitStatus(...remotes: Array<{ fetch: string; push?: string }>): GitStatusSnapshot {
  return createGitStatus({
    remotes: remotes.map((remote, index) => ({
      name: `remote-${index}`,
      fetchUrl: remote.fetch,
      pushUrl: remote.push ?? remote.fetch,
      branches: [],
    })),
  });
}

function ContextHarness({
  activeCloudSession = session,
  activeWorkspace = workspace,
  status,
}: {
  activeCloudSession?: DesktopCloudSession | null;
  activeWorkspace?: Workspace | null;
  status: GitStatusSnapshot;
}) {
  const updateCloudSession = React.useCallback(() => undefined, []);
  const context = useCurrentRepositoryCloudContext({
    activeCloudSession,
    activeGitStatus: status,
    cloudEnabled: true,
    desktopCloudApiBaseUrl: session.api_base_url,
    resolutionInputsLoading: false,
    updateCloudSession,
    workspace: activeWorkspace,
  });
  return <output data-context={JSON.stringify(context)} />;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  cloudApi.getCloudRepositoryContext.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function readContext(): ProjectCloudContext {
  return JSON.parse(container.querySelector("output")?.getAttribute("data-context")
    ?? '{"status":"resolving","projectId":null}') as ProjectCloudContext;
}

async function renderUntil(
  element: React.ReactNode,
  accepted: ProjectCloudContext["status"][],
): Promise<ProjectCloudContext> {
  await act(async () => {
    root.render(element);
    await Promise.resolve();
  });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const context = readContext();
    if (accepted.includes(context.status)) return context;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
  return readContext();
}

describe("current-repository Cloud context", () => {
  it("keeps a repository without a canonical PuppyOne remote local-only", async () => {
    const context = await renderUntil(
      <ContextHarness status={gitStatus()} />,
      ["local-only"],
    );
    expect(context).toEqual({ status: "local-only", projectId: null });
    expect(cloudApi.getCloudRepositoryContext).not.toHaveBeenCalled();
  });

  it("resolves exactly the Project identified by the current repository remote", async () => {
    cloudApi.getCloudRepositoryContext.mockResolvedValue({
      target: { kind: "project_root", project_id: "project-1" },
      project: { id: "project-1", name: "Notes", capabilities: ["content.read"] },
      scope_path: null,
    });
    const context = await renderUntil(
      <ContextHarness status={gitStatus({ fetch: "https://cloud.example/git/project-1.git" })} />,
      ["resolved"],
    );
    expect(context).toEqual({
      status: "resolved",
      projectId: "project-1",
      target: { kind: "project_root", project_id: "project-1" },
      capabilities: ["content.read"],
    });
    expect(cloudApi.getCloudRepositoryContext).toHaveBeenCalledTimes(1);
    expect(cloudApi.getCloudRepositoryContext).toHaveBeenCalledWith(
      session,
      "project-1",
      { kind: "project_root", project_id: "project-1" },
      expect.any(Function),
      session.api_base_url,
    );
  });

  it("resolves an exact Scope while preserving its owning Project", async () => {
    cloudApi.getCloudRepositoryContext.mockResolvedValue({
      target: { kind: "scope", project_id: "project-1", scope_id: "scope-docs" },
      project: { id: "project-1", name: "Notes", capabilities: ["content.read"] },
      scope_path: "docs",
    });
    const context = await renderUntil(
      <ContextHarness status={gitStatus({
        fetch: "https://cloud.example/git/project-1/scopes/scope-docs.git",
      })} />,
      ["resolved"],
    );
    expect(context).toMatchObject({
      status: "resolved",
      projectId: "project-1",
      target: { kind: "scope", project_id: "project-1", scope_id: "scope-docs" },
      scopePath: "docs",
    });
  });

  it("requires a session for a canonical remote without calling the API", async () => {
    const context = await renderUntil(
      <ContextHarness
        activeCloudSession={null}
        status={gitStatus({ fetch: "https://cloud.example/git/project-1.git" })}
      />,
      ["wrong-account"],
    );
    expect(context).toMatchObject({ status: "wrong-account", projectId: "project-1" });
    expect(cloudApi.getCloudRepositoryContext).not.toHaveBeenCalled();
  });

  it("rejects a wrong host and conflicting locators locally", async () => {
    const wrongHost = await renderUntil(
      <ContextHarness status={gitStatus({ fetch: "https://other.example/git/project-1.git" })} />,
      ["wrong-host"],
    );
    expect(wrongHost).toMatchObject({ status: "wrong-host", projectId: "project-1" });

    const conflict = await renderUntil(
      <ContextHarness status={gitStatus({
        fetch: "https://cloud.example/git/project-1.git",
        push: "https://cloud.example/git/project-2.git",
      })} />,
      ["locator-conflict"],
    );
    expect(conflict.status).toBe("locator-conflict");
    expect(cloudApi.getCloudRepositoryContext).not.toHaveBeenCalled();
  });

  it("does not revive the retired access-key remote format", async () => {
    const context = await renderUntil(
      <ContextHarness status={gitStatus({ fetch: "https://cloud.example/git/ap/pwg_secret.git" })} />,
      ["local-only"],
    );
    expect(context).toEqual({ status: "local-only", projectId: null });
    expect(cloudApi.getCloudRepositoryContext).not.toHaveBeenCalled();
  });

  it.each([
    [401, "wrong-account"],
    [403, "not-authorized"],
    [404, "not-found"],
    [503, "temporarily-unavailable"],
  ] as const)("maps HTTP %s to the body recovery phase %s", async (statusCode, expectedStatus) => {
    cloudApi.getCloudRepositoryContext.mockRejectedValue(
      Object.assign(new Error("server detail"), { status: statusCode }),
    );
    const context = await renderUntil(
      <ContextHarness status={gitStatus({ fetch: "https://cloud.example/git/project-1.git" })} />,
      [expectedStatus],
    );
    expect(context.status).toBe(expectedStatus);
  });

  it("keeps SESSION_CHANGED in resolving until a new session key arrives", async () => {
    cloudApi.getCloudRepositoryContext.mockRejectedValue(
      Object.assign(new Error("Cloud session changed"), { code: "SESSION_CHANGED" }),
    );
    const context = await renderUntil(
      <ContextHarness status={gitStatus({ fetch: "https://cloud.example/git/project-1.git" })} />,
      ["resolving"],
    );
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(context.status).toBe("resolving");
    expect(cloudApi.getCloudRepositoryContext).toHaveBeenCalledTimes(1);
  });
});

describe("resolution input gating", () => {
  it("waits only for the initial Git snapshot, never for local config", () => {
    expect(shouldBlockWorkspaceCloudResolution({
      gitStatusError: null,
      gitStatusPath: null,
      workspacePath: "/tmp/notes",
    })).toBe(true);
    expect(shouldBlockWorkspaceCloudResolution({
      gitStatusError: null,
      gitStatusPath: "/tmp/notes",
      workspacePath: "/tmp/notes",
    })).toBe(false);
    expect(shouldBlockWorkspaceCloudResolution({
      gitStatusError: "not a repository",
      gitStatusPath: null,
      workspacePath: "/tmp/notes",
    })).toBe(false);
  });
});
