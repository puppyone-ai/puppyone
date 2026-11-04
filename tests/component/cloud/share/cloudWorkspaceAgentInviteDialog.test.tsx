/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspaceAgentInviteDialog } from "../../../../src/features/cloud/share/CloudWorkspaceAgentInviteDialog";
import type { AgentsPanelControl } from "../../../../src/features/cloud/share/CloudWorkspaceAgentsPanel";
import { cloudApiRequest, type DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { withTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/lib/cloudApi", () => ({ cloudApiRequest: vi.fn() }));
vi.mock("../../../../src/lib/clipboard", () => ({ writeClipboardText: vi.fn().mockResolvedValue(undefined) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = "https://cloud-fixture.puppyone.ai/api/v1";
let root: Root;
const control = (change: Partial<AgentsPanelControl> = {}): AgentsPanelControl => ({
  session: { user_id: "alice" } as DesktopCloudSession, apiBaseUrl: API, projectId: "p1", projectName: "Launch plan",
  waiting: false, onInvited: vi.fn(), onChanged: vi.fn(), ...change });
const dialog = () => document.querySelector<HTMLElement>(".desktop-cloud-agent-invite-dialog");

beforeEach(() => {
  vi.mocked(cloudApiRequest).mockResolvedValue({ links: [], connections: [] });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.clearAllMocks(); });

describe("Inviting another Agent", () => {
  it("is a dialog of its own, titled for what it does, with copying the first thing in reach", async () => {
    await act(async () => root.render(withTestLocalization(
      <CloudWorkspaceAgentInviteDialog control={control()} onClose={vi.fn()} />)));
    expect(dialog()?.getAttribute("role")).toBe("dialog");
    expect(dialog()?.getAttribute("aria-label")).toBe("Invite an agent");
    expect(dialog()?.querySelector("h2")?.textContent).toBe("Invite an agent");
    expect(document.activeElement).toBe(dialog()?.querySelector(".desktop-cloud-agent-share-copy"));
    expect(dialog()?.querySelector(".desktop-cloud-agent-ticket-eyebrow")?.textContent).toBe("Admit one agent");
  });

  it("lets an Agent at the ticket's door in, from the Header's own list, and tells the Header", async () => {
    const onChanged = vi.fn();
    const requests = [{ id: "r1", name: "Claude Code", admission: "sign_in" as const,
      requested_at: "2026-11-04T10:00:00Z", expires_at: "2026-11-04T10:10:00Z" }];
    await act(async () => root.render(withTestLocalization(
      <CloudWorkspaceAgentInviteDialog control={control({ onChanged })} requests={requests} onClose={vi.fn()} />)));
    const letIn = dialog()!.querySelector<HTMLButtonElement>('[data-cloud-agent-request="r1"] .desktop-cloud-agent-request-allow')!;
    expect(letIn.textContent).toBe("Let in");
    await act(async () => letIn.click());
    expect(vi.mocked(cloudApiRequest)).toHaveBeenCalledWith("/agent-links/connections/r1/decision", expect.anything(),
      undefined, { method: "POST", body: JSON.stringify({ decision: "approve" }) }, API);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("closes from its own close button", async () => {
    const onClose = vi.fn();
    await act(async () => root.render(withTestLocalization(
      <CloudWorkspaceAgentInviteDialog control={control()} onClose={onClose} />)));
    await act(async () => dialog()!.querySelector<HTMLButtonElement>(".desktop-dialog-close-button, [aria-label='Close']")!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
