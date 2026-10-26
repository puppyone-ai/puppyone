import { liveWorkbench } from "../../../fixtures/cloud/repositories/liveWorkspace";
/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useCloudAgentWorkspace } from "../../../../src/features/cloud/agent/useCloudAgentWorkspace";
import type { CloudAgentRun } from "../../../../src/features/cloud/agent/cloudAgentClient";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import type { ProjectCloudContext } from "../../../../src/features/cloud/project/context";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const API = "https://cloud-fixture.puppyone.ai/api/v1";
const session: DesktopCloudSession = { api_base_url: API, user_id: "actor", user_email: "fixture@example.com",
  session_generation: "generation", expires_in: 3600, expires_at: Date.now() + 3600000, status: "authenticated" };
const context: ProjectCloudContext = { status: "resolved", projectId: "project",
  target: { kind: "project_root", project_id: "project" }, capabilities: ["content.read"] };
let agent: ReturnType<typeof useCloudAgentWorkspace>;
let root: Root | null = null;
const originalBridge = window.puppyoneDesktop;
function Harness(props: Partial<Parameters<typeof useCloudAgentWorkspace>[0]>) {
  agent = useCloudAgentWorkspace({ context, session, apiBaseUrl: API, active: true, onPublication: () => {}, ...props });
  return <span>{agent.state.draft}</span>;
}
async function render(props: Partial<Parameters<typeof useCloudAgentWorkspace>[0]> = {}) {
  if (!root) { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
  await act(async () => root!.render(<Harness {...props} />));
}
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); localStorage.clear(); window.puppyoneDesktop = originalBridge; });
describe("Cloud Agent view identity", () => {
  it.each(["actor", "origin", "project", "scope", "generation"])("isolates drafts and visibility on %s change", async change => {
    await render();
    const first = agent.controller;
    await act(async () => { agent.controller!.setDraft("Private draft"); agent.controller!.setOpen(true); });
    const changes = {
      actor: { session: { ...session, user_id: "other" } },
      origin: { apiBaseUrl: "https://other-fixture.puppyone.ai/api/v1", session: { ...session, api_base_url: "https://other-fixture.puppyone.ai/api/v1" } },
      project: { context: { ...context, projectId: "other", target: { kind: "project_root", project_id: "other" } } },
      scope: { context: { ...context, target: { kind: "scope", project_id: "project", scope_id: "limited" } } },
      generation: { session: { ...session, session_generation: "new" } },
    } satisfies Record<string, Partial<Parameters<typeof useCloudAgentWorkspace>[0]>>;
    await render(changes[change as keyof typeof changes]);
    expect(agent.controller).not.toBe(first);
    expect(agent.state.draft).toBe(""); expect(agent.open).toBe(false);
    await render(); expect(agent.state.draft).toBe("Private draft"); expect(agent.open).toBe(false);
  });

  it("collapses when leaving Cloud and keeps the conversation closed until explicitly reopened", async () => {
    await render();
    const controller = agent.controller!;
    await act(async () => { controller.setDraft("Cloud draft"); controller.setOpen(true); });
    expect(agent.open).toBe(true);
    await render({ active: false });
    expect(controller.getSnapshot().open).toBe(false);
    expect(controller.getSnapshot().draft).toBe("Cloud draft");
    await render();
    expect(agent.controller).toBe(controller);
    expect(agent.open).toBe(false);
    expect(agent.state.draft).toBe("Cloud draft");
    await act(async () => agent.toggle?.());
    expect(agent.open).toBe(true);
    expect(agent.state.draft).toBe("Cloud draft");
  });

  it("keeps a delayed admission with its original project while the user changes projects", async () => {
    let finish: (value: CloudAgentRun) => void = () => {};
    window.puppyoneDesktop = { ...originalBridge, requestCloudSessionApi: request => request.path.endsWith("/workbench") ? Promise.resolve(request.method === "POST" ? liveWorkbench() : { workspace: liveWorkbench() }) : new Promise(resolve => {
      finish = run => resolve({ transport: "puppyone-cloud-ipc-v1", ok: true, data: { ...run, request_id: JSON.parse(request.body!).request_id } });
    }) } as NonNullable<typeof window.puppyoneDesktop>;
    await render(); await act(async () => agent.controller!.setOpen(true));
    const first = agent.controller!;
    let sending!: Promise<boolean>;
    await act(async () => { first.setDraft("Private instruction"); sending = first.submit("Private instruction"); });
    await render({ context: { ...context, projectId: "other", target: { kind: "project_root", project_id: "other" } } });
    await act(async () => {
      finish({ id: "run", project_id: "project", workbench_id: "workbench-project", agent_id: "agent", session_id: "session", request_id: "",
        prompt: "Private instruction", state: "succeeded", sequence: 2, stop_requested: false, snapshot: { text: "Private result" },
        publication: null, created_at: "2026-10-07", updated_at: "2026-10-07" }); await sending;
    });
    expect(agent.state.runs).toEqual([]); expect(agent.state.draft).toBe("");
    expect(first.getSnapshot().runs[0]?.snapshot.text).toBe("Private result");
    await render({ active: false }); expect(agent.open).toBe(false);
    await render(); expect(agent.state.runs[0]?.snapshot.text).toBe("Private result");
  });
});
