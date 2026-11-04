/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspaceHeaderTools } from "../../../../src/features/cloud/workbench/CloudWorkspaceHeaderTools";
import { cloudApiRequest, type DesktopCloudSession } from "../../../../src/lib/cloudApi";
import type { ProjectCloudContext } from "../../../../src/features/cloud/project/context";
import { withTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/lib/cloudApi", async original => ({
  ...await original<typeof import("../../../../src/lib/cloudApi")>(), cloudApiRequest: vi.fn(),
}));
vi.mock("../../../../src/features/cloud/share/CloudWorkspaceAgentsDialog", () => ({
  CloudWorkspaceAgentsDialog: ({ control, onClose }: {
    control: { projectId: string }; onClose: () => void;
  }) => <div role="dialog" data-project={control.projectId}>
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
beforeEach(() => {
  vi.mocked(cloudApiRequest).mockImplementation(async path =>
    String(path).endsWith("/agent-links") ? { links: [], connections: [] } : []);
});
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.clearAllMocks(); });
async function render(props: Partial<Parameters<typeof CloudWorkspaceHeaderTools>[0]> = {}) {
  if (!root) { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
  await act(async () => root?.render(withTestLocalization(<CloudWorkspaceHeaderTools
    context={context()} session={session} apiBaseUrl={API} onSessionChange={vi.fn()} {...props} />)));
  await act(async () => { await Promise.resolve(); });
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
  it("keeps people sharing out of the Header for now, and holds the invite seat while it is checked", async () => {
    await render({ context: null });
    expect(button("share")).toBeNull();
    expect(button("automation")).toBeNull();
    expect(button("history")).toBeNull();
    expect(button("invite-agent").disabled).toBe(true);
    expect(button("invite-agent").getAttribute("aria-label")).toBe("Checking…");
    expect(button("invite-agent").querySelector(".animate-spin")).not.toBeNull();
    await render();
    expect(button("invite-agent").disabled).toBe(false);
    expect(button("invite-agent").getAttribute("aria-label")).toBe("Invite an agent");
  });

  it("keeps the seat checking until the server answers, and drops it for someone who may not invite", async () => {
    let refuse = () => {};
    vi.mocked(cloudApiRequest).mockImplementation(path => String(path).endsWith("/agent-links")
      ? new Promise((_, reject) => { refuse = () => reject(Object.assign(new Error("denied"), { status: 403 })); })
      : Promise.resolve([]));
    await render();
    expect(button("invite-agent").dataset.checking).toBe("true");
    await act(async () => { refuse(); await Promise.resolve(); });
    expect(button("invite-agent")).toBeNull();
    // Nothing stands before the Agent pane, so no divider does either.
    expect(document.querySelector(".desktop-titlebar-action-divider")).toBeNull();
  });

  it("puts a divider between the invite seat and the Agent pane", async () => {
    await render();
    const divider = button("invite-agent").closest(".desktop-titlebar-cloud-agents-anchor")?.nextElementSibling;
    expect(divider?.classList.contains("desktop-titlebar-action-divider")).toBe(true);
    expect(divider?.nextElementSibling?.contains(button("agent"))).toBe(true);
  });

  it("opens the Agents dialog for the active hosted project and allows dismissal", async () => {
    await render();
    await act(async () => button("invite-agent").click());
    expect(document.querySelector("[role=dialog]")?.getAttribute("data-project")).toBe("hosted-project");
    expect(button("invite-agent").getAttribute("aria-expanded")).toBe("true");
    act(() => document.querySelector<HTMLButtonElement>("[role=dialog] button")!.click());
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("closes a task when the active Cloud project changes", async () => {
    await render(); await act(async () => button("invite-agent").click());
    await render({ context: context("other-project") });
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await act(async () => button("invite-agent").click());
    expect(document.querySelector("[role=dialog]")?.getAttribute("data-project")).toBe("other-project");
  });

  it.each(["account", "generation", "host", "sign-out"])("revokes an open task on %s change", async change => {
    await render(); await act(async () => button("invite-agent").click());
    const changes = {
      account: { session: { ...session, user_id: "two" } },
      generation: { session: { ...session, session_generation: "two" } },
      host: { apiBaseUrl: "https://other-cloud-fixture.puppyone.ai/api/v1" },
      "sign-out": { session: null },
    };
    await render(changes[change as keyof typeof changes]);
    expect(document.querySelector("[role=dialog]")).toBeNull();
    if (change === "sign-out") expect(button("invite-agent")).toBeNull();
  });
});
