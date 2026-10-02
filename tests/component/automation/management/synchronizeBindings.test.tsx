/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopCloudSession, DesktopCloudSynchronizeBinding } from "../../../../src/lib/cloudApi";
import { useSynchronizeBindings } from "../../../../src/features/automation/useSynchronizeBindings";

const list = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/lib/cloudApi", async (original) => ({
  ...(await original<typeof import("../../../../src/lib/cloudApi")>()),
  listSynchronizeBindings: list,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const session: DesktopCloudSession = {
  expires_in: 3600, expires_at: Date.now() + 3600000, user_id: "user-1", user_email: "user@example.test",
  api_base_url: "https://api.example.test/api/v1", session_generation: "generation-1", status: "authenticated",
};
const onSessionChange = () => undefined;
const binding: DesktopCloudSynchronizeBinding = {
  id: "binding-not-access", project_id: "project-1", path: "no-scope-needed", provider: "url",
  direction: "inbound", config: {}, status: "active",
};
let root: Root | null = null;
let container: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.resetAllMocks();
});

function Harness({ current = session, projectId = "project-1" }: { current?: DesktopCloudSession; projectId?: string }) {
  const data = useSynchronizeBindings(projectId, current, onSessionChange);
  return <><output>{data.bindings.map((item) => item.id).join(",")}</output>
    <span role="alert">{data.error}</span>
    <button onClick={() => void data.reload().catch(() => undefined)}>reload</button></>;
}
function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
}
async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe("Synchronize list lifecycle", () => {
  it("reloads persisted bindings on remount and retries a failed refresh without Access data", async () => {
    list.mockResolvedValue([binding]);
    mount();
    act(() => root?.render(<Harness />));
    await flush();
    expect(container.querySelector("output")?.textContent).toBe(binding.id);
    expect(list).toHaveBeenCalledWith(session, "project-1", onSessionChange, session.api_base_url);
    list.mockRejectedValueOnce(new Error("list unavailable"));
    act(() => container.querySelector("button")?.click());
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("list unavailable");
    expect(container.querySelector("output")?.textContent).toBe(binding.id);
    act(() => container.querySelector("button")?.click());
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("");
    act(() => root?.unmount());
    root = createRoot(container);
    act(() => root?.render(<Harness />));
    await flush();
    expect(list).toHaveBeenCalledTimes(4);
    expect(container.querySelector("output")?.textContent).toBe(binding.id);
  });

  it("ignores late previous-project responses", async () => {
    let resolveOld!: (value: DesktopCloudSynchronizeBinding[]) => void;
    list.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce([{ ...binding, id: "new-binding", project_id: "project-2" }]);
    mount();
    act(() => root?.render(<Harness />));
    act(() => root?.render(<Harness projectId="project-2" />));
    await flush();
    await act(async () => resolveOld([binding]));
    expect(container.querySelector("output")?.textContent).toBe("new-binding");
  });

  it.each(["user", "generation", "server"])("immediately hides old data on %s changes", async (change) => {
    list.mockResolvedValueOnce([binding]).mockReturnValue(new Promise(() => undefined));
    mount();
    act(() => root?.render(<Harness />));
    await flush();
    const current = { ...session,
      ...(change === "user" ? { user_id: "user-2" } : change === "generation"
        ? { session_generation: "generation-2" } : { api_base_url: "https://other.example.test/api/v1" }),
    };
    act(() => root?.render(<Harness current={current} />));
    expect(container.querySelector("output")?.textContent).toBe("");
  });
});
