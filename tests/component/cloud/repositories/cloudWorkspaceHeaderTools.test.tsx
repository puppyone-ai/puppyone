/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspaceHeaderTools } from "../../../../src/features/cloud/workbench/CloudWorkspaceHeaderTools";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import type { ProjectCloudContext } from "../../../../src/features/cloud/project/context";
import { withTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/features/cloud/workbench/CloudWorkspaceToolDialog", () => ({
  CloudWorkspaceToolDialog: ({ tool, context, session, onClose }: {
    tool: string; context: { projectId: string }; session: DesktopCloudSession; onClose: () => void;
  }) => <div role="dialog" data-tool={tool} data-project={context.projectId} data-account={session.user_id}>
    <button onClick={onClose}>Close</button>
  </div>,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const API = "https://cloud-fixture.puppyone.ai/api/v1";
const session: DesktopCloudSession = { api_base_url: API, user_id: "one", user_email: "one@example.com", session_generation: "one",
  expires_in: 3600, expires_at: Date.now() + 3600000, status: "authenticated" };
const context = (id = "hosted-project"): ProjectCloudContext => ({ status: "resolved", projectId: id,
  target: { kind: "project_root", project_id: id }, capabilities: ["content.read"] });
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });
async function render(props: Partial<Parameters<typeof CloudWorkspaceHeaderTools>[0]> = {}) {
  if (!root) { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
  await act(async () => root?.render(withTestLocalization(<CloudWorkspaceHeaderTools
    context={context()} session={session} apiBaseUrl={API} onSessionChange={vi.fn()} {...props} />)));
}
const button = (tool: string) => document.querySelector<HTMLButtonElement>(`[data-cloud-workspace-tool="${tool}"]`)!;

describe("Cloud workspace Header tools", () => {
  it("enables the shared Agent entry and toggles its sidebar state", async () => {
    const toggle = vi.fn(); await render({ onToggleAgent: toggle });
    expect(button("agent").disabled).toBe(false);
    expect(button("agent").getAttribute("aria-expanded")).toBe("false");
    act(() => button("agent").click()); expect(toggle).toHaveBeenCalledTimes(1);
    await render({ onToggleAgent: toggle, agentOpen: true });
    expect(button("agent").getAttribute("aria-expanded")).toBe("true");
    expect(button("agent").getAttribute("aria-label")).toBe("Hide Agent");
    act(() => button("agent").click()); expect(toggle).toHaveBeenCalledTimes(2);
  });
  it("presents both actions during preparation without opening a task before commit", async () => {
    await render({ context: null });
    expect(button("automation").textContent).toBe("");
    expect(button("automation").getAttribute("aria-label")).toBe("Automations");
    expect(button("connect").textContent).toBe("");
    expect(button("connect").getAttribute("aria-label")).toBe("Connect");
    expect(button("automation").disabled).toBe(true);
    expect(button("connect").disabled).toBe(true);
    act(() => button("connect").click());
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await render();
    expect(button("connect").disabled).toBe(false);
  });

  it.each(["automation", "connect"])("opens %s for the authorized hosted project and allows dismissal", async tool => {
    await render();
    act(() => button(tool).click());
    expect(document.querySelector("[role=dialog]")?.getAttribute("data-tool")).toBe(tool);
    expect(document.querySelector("[role=dialog]")?.getAttribute("data-project")).toBe("hosted-project");
    expect(button(tool).getAttribute("aria-expanded")).toBe("true");
    act(() => document.querySelector<HTMLButtonElement>("[role=dialog] button")!.click());
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("closes a task when the active Cloud project changes", async () => {
    await render(); act(() => button("connect").click());
    await render({ context: context("other-project") });
    expect(document.querySelector("[role=dialog]")).toBeNull();
    act(() => button("connect").click());
    expect(document.querySelector("[role=dialog]")?.getAttribute("data-project")).toBe("other-project");
  });

  it.each(["account", "generation", "host", "sign-out"])("revokes an open task on %s change", async change => {
    await render(); act(() => button("automation").click());
    const changes = {
      account: { session: { ...session, user_id: "two" } },
      generation: { session: { ...session, session_generation: "two" } },
      host: { apiBaseUrl: "https://other-cloud-fixture.puppyone.ai/api/v1" },
      "sign-out": { session: null },
    };
    await render(changes[change as keyof typeof changes]);
    expect(document.querySelector("[role=dialog]")).toBeNull();
    if (change === "sign-out") expect(button("connect").disabled).toBe(true);
  });
});
