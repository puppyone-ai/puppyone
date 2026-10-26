/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProjectReachFlow, type ProjectReachFlow } from "../../../../src/features/cloud/share/project-reach/useProjectReachFlow";
import { getShareTarget } from "../../../../src/features/cloud/share/shareTargets";
import { gitStatus } from "../../../support/source-control/gitFixtures";
import { buildProjectShares } from "../../../../src/features/cloud/share/useProjectShares";

const api = vi.hoisted(() => ({ createCloudMcpEndpoint: vi.fn(), listCloudScopes: vi.fn(), createCloudScope: vi.fn() }));
vi.mock("../../../../src/lib/cloudApi", async () => ({
  ...await vi.importActual<typeof import("../../../../src/lib/cloudApi")>("../../../../src/lib/cloudApi"), ...api,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Props = Parameters<typeof useProjectReachFlow>[0];
let root: Root;
let flow: ProjectReachFlow;
let props: Props;
function Harness(input: Props) { flow = useProjectReachFlow(input); return null; }
async function render(next: Partial<Props> = {}) {
  props = { ...props, ...next };
  await act(async () => root.render(<Harness {...props} />));
}
beforeEach(() => {
  vi.clearAllMocks();
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  window.puppyoneDesktop = { getGitStatus: vi.fn(async () => gitStatus()) } as unknown as Window["puppyoneDesktop"];
  props = {
    workspacePath: "/fixture/notes", apiBaseUrl: "https://fixture.invalid/api/v1",
    session: { user_id: "alice", user_email: "alice@example.test", api_base_url: "https://fixture.invalid/api/v1", session_generation: "alice-1", status: "authenticated", expires_in: 3600, expires_at: 4102444800 },
    projectContext: { status: "resolved", projectId: "project", target: { kind: "project_root", project_id: "project" } },
    publish: { loading: false, progress: null, error: null, start: vi.fn(async () => {}) },
    shares: { shares: [], loaded: true, loading: false, error: false, reload: vi.fn(async () => {}) },
    target: getShareTarget("claude"), targetLabel: "Claude", scope: { path: "", mode: "r" },
    onIssued: vi.fn(), onSessionChange: vi.fn(),
  };
  api.createCloudMcpEndpoint.mockResolvedValue({ id: "endpoint", project_id: "project", api_key: "mcp_fixture" });
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ""; });

it("does not issue access while a resolved project's first push is still running", async () => {
  await render({ publish: { ...props.publish, loading: true } });
  await act(async () => flow.start());
  expect(flow.phase).toBe("publishing");
  expect(api.createCloudMcpEndpoint).not.toHaveBeenCalled();
  await render({ publish: { ...props.publish, loading: false } });
  expect(flow.phase).toBe("ready");
  expect(api.createCloudMcpEndpoint).toHaveBeenCalledTimes(1);
});

it("resumes an incomplete first push even when the remote already resolves", async () => {
  await render({ publish: { ...props.publish, pending: true } });
  await act(async () => flow.start());
  expect(props.publish.start).toHaveBeenCalledTimes(1);
  expect(flow.phase).toBe("publishing");
  expect(api.createCloudMcpEndpoint).not.toHaveBeenCalled();
  await render({ publish: { ...props.publish, pending: false } });
  expect(flow.phase).toBe("ready");
});

it("shows a push failure instead of issuing a link for an empty project", async () => {
  await render({ publish: { ...props.publish, pending: true } });
  await act(async () => flow.start());
  await render({ publish: { ...props.publish, error: { code: "UNKNOWN", retryable: true } } });
  expect(flow.phase).toBe("failed");
  expect(flow.failure?.kind).toBe("publish");
  expect(api.createCloudMcpEndpoint).not.toHaveBeenCalled();
});

it("does not accept an issued credential after the account changes", async () => {
  let resolve!: (endpoint: unknown) => void;
  api.createCloudMcpEndpoint.mockReturnValue(new Promise(r => { resolve = r; }));
  await render(); await act(async () => flow.start());
  expect(flow.phase).toBe("issuing");
  await render({ session: { ...props.session!, user_id: "bob", session_generation: "bob-1" } });
  await act(async () => resolve({ id: "old-account-key", project_id: "project" }));
  expect(props.onIssued).not.toHaveBeenCalled();
  expect(flow.issue).toBeNull();
  expect(flow.phase).toBe("form");
});

it.each([
  ["ChatGPT", "mcp_other_agent"],
  ["Claude", ""],
])("does not reuse %s's unavailable or different-destination credential", async (name, key) => {
  await render({ shares: { ...props.shares, shares: buildProjectShares([{
    id: "old", project_id: "project", name, api_key: key, path: "", status: "active",
    accesses: [{ path: "", json_path: "", readonly: true }],
  }], null) } });
  await act(async () => flow.start());
  expect(api.createCloudMcpEndpoint).toHaveBeenCalledTimes(1);
  expect(flow.issue?.endpoint?.id).toBe("endpoint");
});
