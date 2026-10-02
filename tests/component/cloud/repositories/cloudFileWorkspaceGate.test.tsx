/** @vitest-environment happy-dom */
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudFileWorkspaceGate } from "../../../../src/features/cloud/workbench/CloudFileWorkspaceGate";
import type { CloudServiceMainViewProps } from "../../../../src/features/cloud/types";
import type { CloudInitializationRoute } from "../../../../src/features/cloud/initialization/CloudInitializationRoute";
import { withTestLocalization } from "../../../support/react/localization";

const initialization = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/features/cloud/initialization/CloudInitializationRoute", () => ({
  CloudInitializationRoute: (props: ComponentProps<typeof CloudInitializationRoute>) => {
    initialization(props);
    return <button onClick={() => props.onPublishWorkspace()}>Create Cloud version</button>;
  },
}));
vi.mock("../../../../src/features/cloud/auth/CloudSignedOutRoute", () => ({
  CloudSignedOutRoute: () => <div data-sign-in="true">Sign in</div>,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const apiBaseUrl = "https://cloud-fixture.puppyone.ai/api/v1";
const session = { api_base_url: apiBaseUrl, user_id: "owner", user_email: "owner@example.com", session_generation: "first",
  expires_in: 3600, expires_at: Date.now() + 3_600_000, status: "authenticated" as const };
let root: Root | null = null;
const render = async (overrides: Partial<CloudServiceMainViewProps> = {}) => {
  const props: CloudServiceMainViewProps = {
    workspace: { id: "local", name: "Project", path: "/fixture/project", status: "recording" },
    status: null, cloudEnvironment: { apiBaseUrl, source: "default", cloudRemote: null },
    cloudAuthState: { status: "signed-in", apiBaseUrl, session },
    projectContext: { status: "local-only", projectId: null },
    onCloudSessionChange: vi.fn(), activeSection: "team", automationEnabled: false,
    loading: false, error: null, cloudBackupLoading: false, cloudBackupPending: false,
    cloudPublishError: null, cloudPublishNotice: null, cloudPublishState: null, cloudPublishStateLoading: false,
    onAbandonPuppyoneBackup: vi.fn(), onStartPuppyoneBackup: vi.fn(), onSelectSection: vi.fn(),
    onRefresh: vi.fn(), onOpenGitSettings: vi.fn(), ...overrides,
  };
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(withTestLocalization(<CloudFileWorkspaceGate {...props} />)));
  return props;
};
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; vi.clearAllMocks(); });

describe("Cloud file-provider gate", () => {
  it("requires sign-in in the editor area without entering the Cloud service router", async () => {
    const props = await render({ cloudAuthState: { status: "signed-out", apiBaseUrl } });
    expect(document.querySelector("[data-sign-in]")).not.toBeNull();
    expect(document.querySelector("aside, nav, [role=dialog]")).toBeNull();
    expect(initialization).not.toHaveBeenCalled();
    expect(props.onStartPuppyoneBackup).not.toHaveBeenCalled();
    expect(props.onSelectSection).not.toHaveBeenCalled();
  });
  it("offers explicit creation independently of the last Cloud management route", async () => {
    const props = await render();
    expect(initialization.mock.calls[0]![0].activeSection).toBe("initialize");
    expect(props.onStartPuppyoneBackup).not.toHaveBeenCalled();
    await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
    expect(props.onStartPuppyoneBackup).toHaveBeenCalledOnce();
    expect(props.onSelectSection).not.toHaveBeenCalled();
  });
  it("keeps project resolution in a loading state without showing organization services", async () => {
    const props = await render({ projectContext: { status: "resolving", projectId: null } });
    expect(document.querySelector("[data-cloud-file-provider-state]")?.getAttribute("data-cloud-file-provider-state")).toBe("resolving");
    expect(document.querySelector("[role=status]")).not.toBeNull();
    expect(initialization).not.toHaveBeenCalled();
    expect(props.onSelectSection).not.toHaveBeenCalled();
  });
  it("offers provider recovery without replacing the file Sidebar", async () => {
    const props = await render({ projectContext: { status: "temporarily-unavailable", projectId: null,
      message: { code: "remote-network-failed" } } });
    expect(document.querySelector("aside, nav, [role=dialog]")).toBeNull();
    const retry = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Retry")!;
    await act(async () => retry.click());
    expect(props.onRefresh).toHaveBeenCalledOnce();
    expect(props.onStartPuppyoneBackup).not.toHaveBeenCalled();
  });
});
