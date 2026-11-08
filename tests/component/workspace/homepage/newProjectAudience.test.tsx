/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingProjectEntryDialog } from "../../../../src/components/OnboardingProjectEntryDialog";
import type { CloudSpace } from "../../../../src/lib/workspaceHomeModel";
import type { WorkspaceCreateProjectRequest, WorkspaceCreateProjectResult } from "../../../../src/types/electron";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });

const PERSONAL: CloudSpace = { id: "personal", name: "Personal", kind: "personal", canCreateProjects: true };
const DESIGN: CloudSpace = { id: "design", name: "Design", kind: "team", canCreateProjects: true };
const READERS: CloudSpace = { id: "readers", name: "Readers", kind: "team", canCreateProjects: false };
const RESEARCH: CloudSpace = { id: "research", name: "Research", kind: "team", canCreateProjects: true };

type Props = Partial<Parameters<typeof OnboardingProjectEntryDialog>[0]>;
const opened = (status: "opened-current" | "opened-new" = "opened-current") => vi.fn(async (request: WorkspaceCreateProjectRequest) => ({
  initialization: { operationId: request.operationId, outcome: "committed", path: "/projects/Plans", name: request.name,
    createdPaths: [], initialOpenPath: null, template: null },
  opening: { status: "opened", result: { status, workspaceId: "plans", path: "/projects/Plans" } },
}) as unknown as WorkspaceCreateProjectResult);

async function render(props: Props = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(withTestLocalization(<OnboardingProjectEntryDialog onClose={vi.fn()}
    onDefaultLocation={async () => ({ grantId: "location", path: "/projects" })} onSubmit={opened()} {...props} />)));
  await act(async () => { await Promise.resolve(); });
  const input = host.querySelector<HTMLInputElement>('input[type="text"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Plans");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return host;
}
const audiences = (host: HTMLElement) => [...host.querySelectorAll<HTMLInputElement>('input[name="onboarding-entry-audience"]')].map((radio) => radio.value);
const choose = (host: HTMLElement, value: string) => act(() => { host.querySelector<HTMLInputElement>(`input[value="${value}"]`)!.click(); });
const submit = (host: HTMLElement) => act(async () => { host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); await Promise.resolve(); });

describe("New project: who can open it", () => {
  it("asks nothing when this computer is the only place the project can go", async () => {
    const host = await render();
    expect(audiences(host)).toEqual([]);
    expect(host.textContent).toContain("Location");
  });

  it("offers a team only where the account may start projects, and never the personal space", async () => {
    const host = await render({ cloudSpaces: [PERSONAL, READERS, DESIGN], onCreateCloudProject: vi.fn(), onShareWithMyDevices: vi.fn() });
    expect(audiences(host)).toEqual(["local", "devices", "team"]);
    expect(host.querySelector<HTMLInputElement>('input[value="local"]')!.checked).toBe(true);
    // With one team to choose there is nothing to pick between.
    expect(host.querySelector("select")).toBeNull();
    const none = await render({ cloudSpaces: [PERSONAL, READERS], onCreateCloudProject: vi.fn() });
    expect(audiences(none)).toEqual([]);
  });

  it("keeps a team's project in the Cloud, made in the chosen team, without touching this computer", async () => {
    const onCreateCloudProject = vi.fn(async () => {});
    const onSubmit = opened();
    const onClose = vi.fn();
    const host = await render({ cloudSpaces: [DESIGN, RESEARCH], onCreateCloudProject, onSubmit, onClose });
    choose(host, "team");
    expect(host.textContent).toContain("Stored on");
    expect(host.querySelector(".onboarding-entry-location-picker.is-fixed")?.textContent).toBe("Cloud");
    const select = host.querySelector<HTMLSelectElement>("select")!;
    expect([...select.options].map((option) => option.textContent)).toEqual(["Design", "Research"]);
    act(() => { select.value = "research"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await submit(host);
    expect(onCreateCloudProject).toHaveBeenCalledExactlyOnceWith("research", "Plans", expect.any(String));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("retries the same team project under the same operation, and a changed name is a new one", async () => {
    const onCreateCloudProject = vi.fn<(spaceId: string, name: string, operationId: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("The Cloud did not answer."))
      .mockRejectedValueOnce(new Error("The Cloud did not answer."))
      .mockResolvedValue(undefined);
    const host = await render({ cloudSpaces: [DESIGN], onCreateCloudProject });
    choose(host, "team");
    await submit(host);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("The Cloud did not answer.");
    await submit(host);
    const [first, retry] = onCreateCloudProject.mock.calls.map((call) => call[2]);
    expect(retry).toBe(first);
    const input = host.querySelector<HTMLInputElement>('input[type="text"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Plans 2");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit(host);
    expect(onCreateCloudProject.mock.calls[2]).toEqual(["design", "Plans 2", expect.not.stringMatching(first!)]);
  });

  it("makes an all-my-devices project here, then opens it to the other computers", async () => {
    const onShareWithMyDevices = vi.fn(async () => {});
    const onSubmit = opened();
    const host = await render({ onShareWithMyDevices, onSubmit });
    choose(host, "devices");
    expect(host.querySelector(".onboarding-entry-location-path")?.textContent).toBe("/projects");
    await submit(host);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onShareWithMyDevices).toHaveBeenCalledExactlyOnceWith("/projects/Plans");
  });

  it("shares nothing from this window when the project opened in another one", async () => {
    const onShareWithMyDevices = vi.fn(async () => {});
    const host = await render({ onShareWithMyDevices, onSubmit: opened("opened-new") });
    choose(host, "devices");
    await submit(host);
    expect(onShareWithMyDevices).not.toHaveBeenCalled();
  });

  it("shares nothing for a project kept only on this computer", async () => {
    const onShareWithMyDevices = vi.fn(async () => {});
    const host = await render({ onShareWithMyDevices });
    await submit(host);
    expect(onShareWithMyDevices).not.toHaveBeenCalled();
  });
});
