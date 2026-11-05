/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudPublishTask } from "../../../../src/features/cloud/initialization/CloudPublishTask";
import { CloudPublishDialog } from "../../../../src/features/cloud/initialization/CloudPublishDialog";
import type { CloudProjectPreparationProps } from "../../../../src/features/cloud/types";
import { withTestLocalization } from "../../../support/react/localization";

const preparation = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/features/cloud/workbench/CloudFileWorkspaceGate", () => ({
  CloudFileWorkspaceGate: (props: CloudProjectPreparationProps) => {
    preparation(props); return <div data-preparation="true">Preparation</div>;
  },
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const apiBaseUrl = "https://cloud-fixture.puppyone.ai/api/v1";
const session = { api_base_url: apiBaseUrl, user_id: "owner", user_email: "owner@example.com", session_generation: "first",
  expires_in: 3600, expires_at: Date.now() + 3_600_000, status: "authenticated" as const };
const resolved = { status: "resolved" as const, projectId: "p1", projectName: "Cloud Notes",
  target: { kind: "project_root" as const, project_id: "p1" } };
let root: Root | null = null;
async function render(overrides: Partial<CloudProjectPreparationProps> = {}) {
  const props = {
    workspace: { id: "local", name: "Local Notes", path: "/fixture/notes", status: "recording" as const },
    status: null, cloudEnvironment: { apiBaseUrl, source: "default" as const, cloudRemote: null },
    cloudAuthState: { status: "signed-in" as const, apiBaseUrl, session }, projectContext: resolved,
    onCloudSessionChange: vi.fn(), loading: false, error: null, cloudBackupLoading: false, cloudBackupPending: false,
    cloudPublishError: null, cloudPublishNotice: null, cloudPublishState: null, cloudPublishStateLoading: false,
    onAbandonPuppyoneBackup: vi.fn(), onStartPuppyoneBackup: vi.fn(), onRefresh: vi.fn(), onOpenGitSettings: vi.fn(), ...overrides,
    onOpenCloudProject: vi.fn(),
  };
  if (!root) { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
  await act(async () => root!.render(withTestLocalization(<CloudPublishDialog onClose={vi.fn()}><CloudPublishTask {...props} /></CloudPublishDialog>)));
  return props;
}
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.clearAllMocks(); });

describe("Cloud publish task", () => {
  it("shows the result without navigating away from the local project automatically", async () => {
    const props = await render();
    expect(document.querySelector("h1")?.textContent).toBe("Cloud project ready");
    expect(document.body.textContent).toContain("changes here reach it only when you send them");
    expect(document.querySelector("aside, nav")).toBeNull();
    expect(preparation).not.toHaveBeenCalled();
    expect(props.onStartPuppyoneBackup).not.toHaveBeenCalled();
    expect(props.onOpenCloudProject).not.toHaveBeenCalled();
    const open = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Open Cloud project")!;
    await act(async () => open.click());
    expect(props.onOpenCloudProject).toHaveBeenCalledWith("p1");
  });
  it("keeps sign-in focused on publishing, with no Share, MCP or CLI destination picker", async () => {
    await render({ cloudAuthState: { status: "signed-out", apiBaseUrl } });
    expect(document.querySelector(".desktop-cloud-auth-submit")).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/Connect another Agent|Access via CLI|Who should be able to read/);
    expect(document.querySelector("aside, nav, .desktop-share-dialog")).toBeNull();
    expect(preparation).not.toHaveBeenCalled();
  });
  it.each(["local", "resolving", "loading", "error", "progress", "journal"])("gives %s precedence over the completed view", async kind => {
    const overrides: Partial<CloudProjectPreparationProps> = {};
    if (kind === "local") overrides.projectContext = { status: "local-only", projectId: null };
    if (kind === "resolving") overrides.projectContext = { status: "resolving", projectId: null };
    if (kind === "loading") overrides.cloudPublishStateLoading = true;
    if (kind === "error") overrides.cloudPublishError = { code: "UNKNOWN", retryable: true };
    if (kind === "progress") overrides.cloudPublishProgress = { rootPath: "/fixture/notes", operationId: "one", stage: "uploading", state: null, updatedAt: "2026-11-05T00:00:00Z" };
    if (kind === "journal") overrides.cloudPublishState = { project: "empty", push: "failed" } as NonNullable<CloudProjectPreparationProps["cloudPublishState"]>;
    await render(overrides);
    expect(document.querySelector("[data-preparation]")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Cloud project ready");
  });
  it("revokes a displayed result when the account or repository changes", async () => {
    await render();
    await render({ workspace: { id: "other", name: "Other", path: "/fixture/other", status: "recording" },
      cloudAuthState: { status: "signed-in", apiBaseUrl, session: { ...session, user_id: "other", session_generation: "second" } },
      projectContext: { status: "resolving", projectId: null } });
    expect(document.body.textContent).not.toContain("Cloud Notes");
    expect(document.querySelector("[data-preparation]")).not.toBeNull();
  });
});
