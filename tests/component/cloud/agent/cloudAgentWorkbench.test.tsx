/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudAgentWorkbench } from "../../../../src/features/cloud/agent/CloudAgentWorkbench";
import { CloudAgentSidebar } from "../../../../src/features/cloud/agent/CloudAgentSidebar";
import { CloudAgentClient } from "../../../../src/features/cloud/agent/cloudAgentClient";
import { createCloudAgentSmokeFixture } from "../../../../src/features/cloud/agent/CloudAgentSmokeFixture";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const API = "https://cloud-fixture.puppyone.ai/api/v1";
const session: DesktopCloudSession = { api_base_url: API, user_id: "actor", user_email: "fixture@example.com",
  session_generation: "generation", expires_in: 3600, expires_at: Date.now() + 3600000, status: "authenticated" };
let root: Root | null = null;
let workbench: CloudAgentWorkbench;
let fixture: ReturnType<typeof createCloudAgentSmokeFixture>;
let stop: (() => void) | undefined;
const bridge = window.puppyoneDesktop;
const makeWorkbench = () => new CloudAgentWorkbench(new CloudAgentClient({ kind: "project_root", project_id: "project" }, session, API), "workbench-fixture", "generation");
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button")];
async function click(label: string) {
  const button = buttons().find(item => (item.getAttribute("aria-label") ?? item.textContent?.trim()) === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function render() {
  if (!root) { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
  await act(async () => {
    root!.render(withTestLocalization(<CloudAgentSidebar workbench={workbench} active />));
  });
}
async function newChat() {
  await click("New tab");
  expect(document.querySelector(".desktop-terminal-launcher")).not.toBeNull();
  expect(document.querySelector(".desktop-terminal-launcher-scan")).toBeNull();
  expect(document.querySelector(".desktop-terminal-launcher-shell")).toBeNull();
  const button = document.querySelector<HTMLButtonElement>(".desktop-terminal-launcher-tool");
  await act(async () => button!.click());
  return workbench.store.getSnapshot().topology.items.at(-1)!.id;
}
beforeEach(() => {
  localStorage.clear();
  fixture = createCloudAgentSmokeFixture(() => {});
  window.puppyoneDesktop = { ...bridge, requestCloudSessionApi: async request => ({
    transport: "puppyone-cloud-ipc-v1", ok: true, data: await fixture.request(request),
  }) } as NonNullable<typeof window.puppyoneDesktop>;
  workbench = makeWorkbench();
});
afterEach(() => {
  act(() => { stop?.(); root?.unmount(); }); stop = undefined; root = null;
  workbench.store.dispose(); vi.restoreAllMocks(); document.body.replaceChildren(); localStorage.clear();
  window.puppyoneDesktop = bridge;
});

describe("Desktop Cloud native workbench", () => {
  it("uses native tabs and launcher, preserving each mounted composer and draft without requests", async () => {
    await render();
    await act(async () => { stop = workbench.observe(() => {}); workbench.primary.setDraft("First draft"); });
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(document.querySelector(".desktop-terminal-tab .desktop-terminal-launcher-icon")).not.toBeNull();
    expect(document.querySelector(".desktop-agent-surface-header")).toBeNull();
    const firstEditor = document.querySelector(".cm-editor");
    const second = await newChat();
    await act(async () => workbench.controller(second)!.setDraft("Second draft"));
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(2);
    await act(async () => workbench.store.dispatch({ type: "activate", itemId: "primary" }));
    expect(document.querySelector(".cm-editor")).toBe(firstEditor);
    expect(workbench.primary.getSnapshot().draft).toBe("First draft");
    expect(workbench.controller(second)!.getSnapshot().draft).toBe("Second draft");
    expect(fixture.state().requests).toEqual([]);
  });

  it("moves chats into native split groups without remounting editors or refetching runs", async () => {
    await render();
    await act(async () => { stop = workbench.observe(() => {}); workbench.primary.setDraft("Split draft"); });
    const firstEditor = document.querySelector(".cm-editor");
    const second = await newChat();
    await act(async () => workbench.store.dispatch({ type: "split-item", sourceItemId: second,
      targetGroupId: workbench.store.getSnapshot().topology.groups[0].id, edge: "bottom", groupId: "split-group", splitId: "split" }));
    expect(workbench.store.getSnapshot().topology.groups).toHaveLength(2);
    expect(document.querySelectorAll(".cm-editor")).toHaveLength(2);
    expect(document.querySelector(".cm-editor")).toBe(firstEditor);
    expect(workbench.primary.getSnapshot().draft).toBe("Split draft");
    expect(fixture.state().requests).toEqual([]);
  });

  it("allows a second conversation during an active run and never stops a task by closing its tab", async () => {
    await render();
    await act(async () => { stop = workbench.observe(() => {}); await workbench.primary.submit("Keep running until I stop"); });
    const second = await newChat();
    await act(async () => { await workbench.controller(second)!.submit("Another task; do not stop yet"); });
    expect(new Set(fixture.state().runs.map(run => run.session_id)).size).toBe(2);
    await click("Close Keep running until I stop");
    expect(workbench.store.getSnapshot().topology.items.map(item => item.id)).toEqual([second]);
    expect(fixture.state().states).toEqual(["running", "running"]);
    expect(fixture.state().requests.filter(path => path.includes("/stop"))).toEqual([]);
  });

  it("uses the native history search/back/list and restores only the selected transcript", async () => {
    await render();
    await act(async () => { stop = workbench.observe(() => {}); await workbench.primary.submit("Keep running until I stop"); await workbench.primary.stop(); });
    const original = fixture.state().runs[0].session_id;
    await click("Close Keep running until I stop");
    const baseline = fixture.state().requests.length;
    await click("Chat history");
    expect(document.querySelector(".desktop-agent-history-view")).not.toBeNull();
    expect(fixture.state().requests.slice(baseline)).toHaveLength(1);
    expect(fixture.state().requests.at(-1)).toContain("/agents/sessions?");
    await click("Search chat history");
    expect(document.querySelector('input[type="search"]')).not.toBeNull();
    await click("Back to Agents");
    expect(document.querySelector(".desktop-terminal-launcher-tool")).not.toBeNull();
    await click("Chat history");
    await click("Open Keep running until I stop");
    const restoredId = workbench.store.getSnapshot().topology.items.at(-1)!.id;
    await act(async () => { await Promise.resolve(); });
    expect(workbench.controller(restoredId)!.getSnapshot().sessionId).toBe(original);
    expect(workbench.controller(restoredId)!.getSnapshot().runs).toHaveLength(1);
    expect(document.querySelector(".desktop-agent-history-view")).toBeNull();
    expect(fixture.state().requests.filter(path => path === "POST /agents/runs")).toHaveLength(1);
    expect(fixture.state().requests.filter(path => path.includes(`/sessions/${original}/runs`))).toHaveLength(1);
  });

  it("shares concurrent history requests, excludes open sessions and never preloads transcripts", async () => {
    await render();
    await act(async () => { stop = workbench.observe(() => {}); await workbench.primary.submit("Keep running until I stop"); });
    const baseline = fixture.state().requests.length;
    await act(async () => { await Promise.all([workbench.refreshHistory(), workbench.refreshHistory()]); });
    expect(fixture.state().requests.slice(baseline)).toHaveLength(1);
    await click("New tab"); await click("Chat history");
    expect(document.querySelector(".desktop-agent-history-option")).toBeNull();
    expect(document.body.textContent).toContain("Discovered chats are already open");
  });

  it("protects an uncertain submission receipt while letting the user open another tab", async () => {
    await render();
    await act(async () => { stop = workbench.observe(() => {}); });
    window.puppyoneDesktop!.requestCloudSessionApi = async () => { throw new Error("Lost receipt"); };
    await act(async () => { await workbench.primary.submit("Keep this receipt"); });
    await click("Close Puppyone Agent");
    expect(document.body.textContent).toContain("Confirm the previous message");
    expect(workbench.store.getSnapshot().topology.items).toHaveLength(1);
    await click("Keep chat open");
    const second = await newChat();
    expect(second).not.toBe("primary");
    expect(workbench.primary.getSnapshot().pending?.prompt).toBe("Keep this receipt");
  });

  it("recovers a pending submission in a secondary tab after reload using its original receipt", async () => {
    await render();
    await act(async () => { stop = workbench.observe(() => {}); });
    const second = await newChat();
    const request = window.puppyoneDesktop!.requestCloudSessionApi;
    window.puppyoneDesktop!.requestCloudSessionApi = async input => {
      await request(input);
      throw new Error("Lost accepted receipt");
    };
    await act(async () => { await workbench.controller(second)!.submit("Keep running until I stop"); });
    const pending = workbench.controller(second)!.getSnapshot().pending!;
    await act(async () => { stop!(); stop = undefined; root!.unmount(); root = null; });
    workbench.store.dispose();
    window.puppyoneDesktop!.requestCloudSessionApi = request;
    workbench = makeWorkbench();
    expect(workbench.controller(second)!.getSnapshot().pending?.request_id).toBe(pending.request_id);
    await render();
    await act(async () => { await workbench.controller(second)!.load(); });
    expect(workbench.controller(second)!.getSnapshot().pending).toBeNull();
    expect(fixture.state().requests.filter(path => path === "POST /agents/runs")).toHaveLength(1);
    expect(fixture.state().requests.some(path => path.includes(`/requests/project/${pending.request_id}`))).toBe(true);
  });

  it("restores tab locators after reload without duplicate submissions", async () => {
    await render();
    await act(async () => { stop = workbench.observe(() => {}); });
    const second = await newChat();
    const controller = workbench.controller(second)!;
    await act(async () => { await controller.submit("Keep running until I stop"); });
    const sessionId = controller.getSnapshot().sessionId;
    await act(async () => { stop!(); stop = undefined; root!.unmount(); root = null; });
    workbench.store.dispose();
    workbench = makeWorkbench();
    expect(workbench.store.getSnapshot().topology.items.map(item => item.id)).toEqual(["primary", second]);
    expect(workbench.controller(second)!.getSnapshot().sessionId).toBe(sessionId);
    await render();
    await act(async () => { stop = workbench.observe(() => {}); await Promise.resolve(); });
    expect(fixture.state().requests.filter(path => path === "POST /agents/runs")).toHaveLength(1);
  });
});
