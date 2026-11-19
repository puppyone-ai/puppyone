/** @vitest-environment happy-dom */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCloudWorkspaceSidebar } from "../../../../src/features/cloud/workbench/useCloudWorkspaceSidebar";
import type { ProjectCloudContext } from "../../../../src/features/cloud/project/context";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const apiBaseUrl = "https://cloud-fixture.puppyone.ai/api/v1";
const session: DesktopCloudSession = { api_base_url: apiBaseUrl, user_id: "one", user_email: "one@example.com",
  session_generation: "one", status: "authenticated", expires_at: Date.now() + 3600000, expires_in: 3600 };
const context: ProjectCloudContext = { status: "resolved", projectId: "project",
  target: { kind: "project_root", project_id: "project" } };
let sidebar: ReturnType<typeof useCloudWorkspaceSidebar>;
let root: Root | null = null;
const stopRun = vi.fn();
type Props = Partial<Omit<Parameters<typeof useCloudWorkspaceSidebar>[0], "agent">>;
function Harness(props: Props) {
  const [open, setOpen] = useState(false);
  sidebar = useCloudWorkspaceSidebar({ context, session, apiBaseUrl, active: true, ...props,
    agent: { open, setOpen, ...{ stopRun } } });
  return <span data-agent-open={open} />;
}
async function render(props: Props = {}) {
  if (!root) { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
  await act(async () => root!.render(<Harness {...props} />));
}
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.clearAllMocks(); });

describe("Cloud auxiliary pane ownership", () => {
  it("switches between History and Agent and closes without stopping the Agent run", async () => {
    await render(); expect(sidebar.open).toBe(false);
    act(() => sidebar.toggleAgent()); expect(sidebar.open).toBe(true);
    expect(document.querySelector("[data-agent-open]")?.getAttribute("data-agent-open")).toBe("true");
    act(() => sidebar.openHistory()); expect(sidebar.historyOpen).toBe(true);
    expect(document.querySelector("[data-agent-open]")?.getAttribute("data-agent-open")).toBe("false");
    act(() => sidebar.toggleAgent()); expect(sidebar.historyOpen).toBe(false); expect(sidebar.open).toBe(true);
    act(() => sidebar.setOpen(false)); expect(sidebar.open).toBe(false);
    expect(stopRun).not.toHaveBeenCalled();
  });
  it("keeps History open when asked for it again; the panel owns its close", async () => {
    await render(); act(() => sidebar.openHistory()); expect(sidebar.open).toBe(true);
    act(() => sidebar.openHistory()); expect(sidebar.historyOpen).toBe(true);
    act(() => sidebar.close()); expect(sidebar.open).toBe(false);
  });
  it("offers no History for a scoped target, which has no project-wide record", async () => {
    await render({ context: { status: "resolved", projectId: "p", target: { kind: "scope", project_id: "p", scope_id: "s" } } });
    expect(sidebar.historyAvailable).toBe(false);
    act(() => sidebar.openHistory()); expect(sidebar.historyOpen).toBe(false);
  });
  it.each(["project", "account", "generation", "host", "local", "sign-out"])("clears History on %s change without reopening it on return", async change => {
    await render(); act(() => sidebar.openHistory());
    const changes: Record<string, Props> = {
      project: { context: { status: "resolved", projectId: "other", target: { kind: "project_root", project_id: "other" } } },
      account: { session: { ...session, user_id: "two" } }, generation: { session: { ...session, session_generation: "two" } },
      host: { apiBaseUrl: "https://other-fixture.puppyone.ai/api/v1" }, local: { active: false }, "sign-out": { session: null },
    };
    await render(changes[change]); expect(sidebar.historyOpen).toBe(false); expect(sidebar.open).toBe(false);
    await render(); expect(sidebar.open).toBe(false);
  });
});
