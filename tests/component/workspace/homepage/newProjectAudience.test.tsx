/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingProjectEntryDialog } from "../../../../src/components/OnboardingProjectEntryDialog";
import type { CloudSpace } from "../../../../src/lib/workspaceHomeModel";
import type { WorkspaceCreateProjectRequest, WorkspaceCreateProjectResult } from "../../../../src/types/electron";
import { withTestLocalization } from "../../../support/react/localization";
import { accessibleName, getByRole, isChecked, isDisabled, queryAllByRole, queryByRole, readableText } from "../../../support/react/queries";

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
  // The default folder arrives from Main before Create is offered.
  await vi.waitFor(() => expect(readableText(location(host))).toContain("/projects"));
  rename(host, "Plans");
  return host;
}
const dialog = (host: HTMLElement) => getByRole(host, "dialog", { name: "Create a project" });
const location = (host: HTMLElement) => getByRole(host, "button", { name: "Location" });
function rename(host: HTMLElement, name: string) {
  const input = getByRole(host, "textbox", { name: "Project name" }) as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const AUDIENCES = { local: "Only this computer", devices: "All my devices", team: "Team" } as const;
/** The audiences offered, as announced. */
const audiences = (host: HTMLElement) => queryAllByRole(host, "radio").map(accessibleName)
  .map((name) => Object.values(AUDIENCES).find((audience) => name.startsWith(audience)));
const audience = (host: HTMLElement, key: keyof typeof AUDIENCES) => getByRole(host, "radio", { name: new RegExp(`^${AUDIENCES[key]}`) });
const choose = (host: HTMLElement, key: keyof typeof AUDIENCES) => act(() => { audience(host, key).click(); });
const submit = (host: HTMLElement) => act(async () => { getByRole(host, "button", { name: "Create project" }).click(); });

describe("New project: who can open it", () => {
  it("asks nothing when this computer is the only place the project can go", async () => {
    const host = await render();
    expect(audiences(host)).toEqual([]);
    expect(readableText(dialog(host))).toContain("Location");
  });

  it("offers a team only where the account may start projects, and never the personal space", async () => {
    const host = await render({ cloudSpaces: [PERSONAL, READERS, DESIGN], onCreateCloudProject: vi.fn(), onShareWithMyDevices: vi.fn() });
    expect(audiences(host)).toEqual(["Only this computer", "All my devices", "Team"]);
    expect(isChecked(audience(host, "local"))).toBe(true);
    // With one team to choose there is nothing to pick between.
    expect(queryByRole(host, "combobox")).toBeNull();
    const none = await render({ cloudSpaces: [PERSONAL, READERS], onCreateCloudProject: vi.fn() });
    expect(audiences(none)).toEqual([]);
  });

  it("keeps a team's project in the Cloud, made in the chosen team, without touching this computer", async () => {
    const onCreateCloudProject = vi.fn(async () => {});
    const onSubmit = opened();
    const onClose = vi.fn();
    const host = await render({ cloudSpaces: [DESIGN, RESEARCH], onCreateCloudProject, onSubmit, onClose });
    choose(host, "team");
    // Where it is kept follows: a team's project is in the Cloud, with no folder to pick.
    expect(readableText(dialog(host))).toContain("Stored on Cloud");
    expect(queryByRole(host, "button", { name: "Location" })).toBeNull();
    const select = getByRole(host, "combobox", { name: "Choose team" }) as HTMLSelectElement;
    expect(queryAllByRole(select, "option").map(accessibleName)).toEqual(["Design", "Research"]);
    act(() => { select.value = "research"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await submit(host);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onCreateCloudProject).toHaveBeenCalledExactlyOnceWith("research", "Plans", expect.any(String));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("retries the same team project under the same operation, and a changed name is a new one", async () => {
    const onCreateCloudProject = vi.fn<(spaceId: string, name: string, operationId: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("The Cloud did not answer."))
      .mockRejectedValueOnce(new Error("The Cloud did not answer."))
      .mockResolvedValue(undefined);
    const host = await render({ cloudSpaces: [DESIGN], onCreateCloudProject });
    choose(host, "team");
    await submit(host);
    await vi.waitFor(() => expect(readableText(getByRole(host, "alert"))).toBe("The Cloud did not answer."));
    // Create is offered again once the attempt has failed.
    await vi.waitFor(() => expect(isDisabled(getByRole(host, "button", { name: "Create project" }))).toBe(false));
    await submit(host);
    await vi.waitFor(() => expect(onCreateCloudProject).toHaveBeenCalledTimes(2));
    const [first, retry] = onCreateCloudProject.mock.calls.map((call) => call[2]);
    expect(retry).toBe(first);
    // The publish contract keys a creation on a canonical lowercase UUIDv4.
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await vi.waitFor(() => expect(isDisabled(getByRole(host, "button", { name: "Create project" }))).toBe(false));
    rename(host, "Plans 2");
    await submit(host);
    await vi.waitFor(() => expect(onCreateCloudProject).toHaveBeenCalledTimes(3));
    expect(onCreateCloudProject.mock.calls[2]).toEqual(["design", "Plans 2", expect.not.stringMatching(first!)]);
  });

  it("makes an all-my-devices project here, then opens it to the other computers", async () => {
    const onShareWithMyDevices = vi.fn(async () => {});
    const onSubmit = opened();
    const host = await render({ onShareWithMyDevices, onSubmit });
    choose(host, "devices");
    // An all-my-devices project is a folder here first.
    expect(readableText(location(host))).toContain("/projects");
    await submit(host);
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onShareWithMyDevices).toHaveBeenCalledExactlyOnceWith("/projects/Plans");
  });

  it("shares nothing from this window when the project opened in another one", async () => {
    const onShareWithMyDevices = vi.fn(async () => {});
    const onClose = vi.fn();
    const host = await render({ onShareWithMyDevices, onSubmit: opened("opened-new"), onClose });
    choose(host, "devices");
    await submit(host);
    // Closing is the last thing creating does; only then is it settled that nothing was shared.
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onShareWithMyDevices).not.toHaveBeenCalled();
  });

  it("shares nothing for a project kept only on this computer", async () => {
    const onShareWithMyDevices = vi.fn(async () => {});
    const onClose = vi.fn();
    const host = await render({ onShareWithMyDevices, onClose });
    await submit(host);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onShareWithMyDevices).not.toHaveBeenCalled();
  });
});
