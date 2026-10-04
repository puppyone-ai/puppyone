/** @vitest-environment happy-dom */
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudNewAutomationDialog } from "../../../../src/features/automation/AutomationCreateDialog";
import type { CloudAutomationSourceEditor, CloudAutomationDestinationEditor, CloudAutomationTriggerEditor } from "../../../../src/features/automation/AutomationControls";
import type { DesktopCloudAutomationProviderSpec, DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { withTestLocalization } from "../../../support/react/localization";

const api = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../../../../src/lib/cloudApi", async importOriginal => ({
  ...await importOriginal<typeof import("../../../../src/lib/cloudApi")>(), createSynchronizeBinding: api.create,
}));
// Exercise the dialog's validation order through the editors' public callbacks.
// The real editors and OAuth lifecycle are covered in the other wizard suites.
vi.mock("../../../../src/features/automation/AutomationControls", () => ({
  CloudAutomationSourceEditor: ({ onConfigValueChange, onSourceChange }: ComponentProps<typeof CloudAutomationSourceEditor>) => <>
    <button onClick={() => onConfigValueChange("query", "notes")}>Fill required field</button>
    <button onClick={() => onSourceChange({ resourceId: "doc-1", resourceName: "Notes", resourceType: "document", resourceUrl: "", metadata: {} })}>Pick source</button>
  </>,
  CloudAutomationDestinationEditor: ({ onChange }: ComponentProps<typeof CloudAutomationDestinationEditor>) => <>
    <button onClick={() => onChange("../outside")}>Invalid destination</button>
    <button onClick={() => onChange("Notes")}>Valid destination</button>
  </>,
  CloudAutomationTriggerEditor: ({ draft, onChange }: ComponentProps<typeof CloudAutomationTriggerEditor>) => <>
    <button onClick={() => onChange({ ...draft, preset: "custom", customCron: "invalid" })}>Invalid trigger</button>
    <button onClick={() => onChange({ ...draft, preset: "manual" })}>Valid trigger</button>
  </>,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = ""; vi.clearAllMocks(); });

describe("Automation configure rendering captured before extraction", () => {
  it("keeps required field, source, destination and trigger errors in priority order", () => {
    const container = render(true);
    capture(container, "required field");
    click(container, "Invalid destination");
    click(container, "Invalid trigger");
    capture(container, "required field wins");
    click(container, "Fill required field");
    capture(container, "source missing wins");
    click(container, "Pick source");
    capture(container, "destination error wins");
    click(container, "Valid destination");
    capture(container, "trigger error");
    click(container, "Valid trigger");
    capture(container, "ready");
  });
  it("disables creation, back, and closing while saving and restores them after failure", async () => {
    let reject!: (error: Error) => void;
    api.create.mockImplementation(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    const container = render(false);
    click(container, "Create Automation");
    capture(container, "saving");
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Close"]')?.disabled).toBe(true);
    await act(async () => reject(new Error("offline")));
    capture(container, "create failure");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("offline");
  });
});
function capture(container: HTMLElement, label: string) {
  expect({
    footer: container.querySelector(".desktop-cloud-automation-dialog-footer-row")?.textContent,
    actions: [...container.querySelectorAll<HTMLButtonElement>(".desktop-cloud-automation-actions button")].map(button => ({ text: button.textContent, disabled: button.disabled })),
  }).toMatchSnapshot(label);
}
function click(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll("button")].find(button => button.textContent === label);
  expect(button, label).toBeDefined(); act(() => button?.click());
}
function render(required: boolean) {
  const provider: DesktopCloudAutomationProviderSpec = {
    provider: "custom_source", display_name: "Custom Source", description: "Test source", auth: required ? "oauth" : "none",
    category: "datasource", creation_mode: "direct", icon: null, default_sync_mode: "manual", supported_sync_modes: ["manual", "scheduled"],
    config_fields: required ? [{ key: "query", label: "Query", type: "text", required: true, default: null, options: null, placeholder: null, hint: null }] : [],
  };
  const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  act(() => root.render(withTestLocalization(<CloudNewAutomationDialog
    projectId="project-1" cloudSession={{} as DesktopCloudSession} apiBaseUrl={null} providers={[provider]} providersLoading={false} providersError={null}
    template={{ id: "custom", provider: provider.provider, sourceLabel: "Custom Source", presentation: "generic", categories: [], iconUrl: null }}
    onCloudSessionChange={vi.fn()} onRefresh={vi.fn(async () => undefined)} onCreated={vi.fn()} onClose={vi.fn()}
  />)));
  return document.querySelector<HTMLElement>("#desktop-overlay-root")!;
}
