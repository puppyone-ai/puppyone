/** @vitest-environment happy-dom */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopCloudShell } from "../../../../src/components/DesktopCloudShell";
import { DesktopTitlebarContext } from "../../../../src/features/app-shell/DesktopTitlebarContext";
import { DesktopWorkspaceLocationSurface } from "../../../../src/features/app-shell/DesktopWorkspaceLocationSurface";
import type { DesktopProjectLocation } from "../../../../src/features/app-shell/DesktopProjectLocationSwitcher";
import { withTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/platform/useDesktopPlatformCapabilities", () => ({
  useDesktopPlatformCapabilities: () => ({ platform: "macos", windowChrome: { mode: "overlay" } }),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Compile the production App bindings, not a fixture's independently authored
// `current` value. The previous native smoke correctly set its own location and
// therefore missed App's hard-coded Local prop while the body showed Cloud.
const app = ts.createSourceFile("App.tsx", readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let locationBinding = "";
let surfaceBinding = "";
let chromeBinding = "";
const headerBindings: string[] = [];
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(app) === "projectLocation") {
    locationBinding = node.initializer?.getText(app) ?? "";
  }
  if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
    const name = node.tagName.getText(app);
    const propName = name === "DesktopWorkspaceLocationSurface" ? "location"
      : name === "DesktopCloudShell" ? "workspaceLocation"
        : name === "DesktopTitlebarContext" || name === "DesktopProjectLocationControls" ? "projectLocation" : null;
    if (propName) {
      const prop = node.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(app) === propName);
      if (prop && ts.isJsxAttribute(prop) && prop.initializer && ts.isJsxExpression(prop.initializer)) {
        const expression = prop.initializer.expression?.getText(app) ?? "";
        if (propName === "location") surfaceBinding = expression;
        else if (propName === "workspaceLocation") chromeBinding = expression;
        else headerBindings.push(expression);
      }
    }
  }
  ts.forEachChild(node, visit);
}
visit(app);

function appLocation(cloudWorkspaceActive: boolean, cloudState: DesktopProjectLocation["cloudState"] = "available", cloudEnabled = true) {
  expect(locationBinding).not.toBe("");
  expect(surfaceBinding).not.toBe("");
  expect(chromeBinding).not.toBe("");
  // Every place control reads the one committed location: the Header context,
  // the Cloud dialog's controls, and the Project rail's row menu.
  expect(headerBindings).toEqual(["projectLocation", "projectLocation", "projectLocation"]);
  const compiled = ts.transpileModule(`const projectLocation = ${locationBinding};
    ({ projectLocation, surface: ${surfaceBinding}, chrome: ${chromeBinding} });`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(compiled, { cloudEnabled, cloudWorkspaceActive, projectCloudLocationState: cloudState,
    headerWorkspaceLocation: cloudWorkspaceActive ? "cloud" : "local",
    repositoryCloudSwitch: { requestedLocation: cloudWorkspaceActive ? "cloud" : "local", pending: false, error: null } }) as {
    projectLocation: DesktopProjectLocation | undefined; surface: "local" | "cloud"; chrome: "local" | "cloud";
  };
}

let root: Root | null = null;
const workspace = { id: "todo", name: "To-Do-List", path: "/fixture/todo", status: "recording" as const };
const menuRef = createRef<HTMLDivElement>();
const noop = () => undefined;
const localButton = () => document.querySelector<HTMLButtonElement>('button[data-project-location="local"]')!;
const cloudButton = () => document.querySelector<HTMLButtonElement>('button[data-project-location="cloud"]')!;
const surface = (name: string) => document.querySelector<HTMLElement>(`[data-workspace-location="${name}"]`)!;

async function renderCommittedLocation(active: boolean, onLocal = vi.fn(), onCloud = vi.fn()) {
  if (!root) { const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
  const state = appLocation(active);
  await act(async () => root!.render(withTestLocalization(
    <DesktopCloudShell workspaceLocation={state.chrome} titlebarCenteredSlot={<DesktopTitlebarContext titlebarLabel={workspace.name}
      workspace={workspace} workspaceFolders={[]} multiRootWorkspacesEnabled={false} availableProjects={[]}
      projectLocation={state.projectLocation} cloudProject={{ id: "cloud-todo" }}
      open={false} refObject={menuRef} onClose={noop} onToggle={noop}
      onViewLocal={onLocal} onViewCloud={onCloud} />}>
    <DesktopWorkspaceLocationSurface location={state.surface}
      local={<input aria-label="Local draft" defaultValue="LOCAL_ONLY" />}
      cloud={<div data-cloud-native="true">CLOUD_ONLY</div>} />
    </DesktopCloudShell>)));
  const trigger = document.querySelector<HTMLButtonElement>(".desktop-titlebar-location-button");
  if (trigger?.getAttribute("aria-expanded") === "false") act(() => trigger.click());
}

afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("production App location wiring", () => {
  it.each([false, true, false])("binds the Header and body to the same committed Cloud state (%s)", (active) => {
    const state = appLocation(active);
    expect(state.surface).toBe(active ? "cloud" : "local");
    expect(state.projectLocation?.current).toBe(state.surface);
    expect(state.chrome).toBe(state.surface);
  });

  it("updates the Header icon, menu selection and return action when Cloud content becomes visible", async () => {
    const onLocal = vi.fn(), onCloud = vi.fn();
    await renderCommittedLocation(false, onLocal, onCloud);
    const header = document.querySelector(".desktop-titlebar");
    const shell = document.querySelector(".desktop-shell");
    const title = document.querySelector(".desktop-titlebar-location-button");
    const draft = document.querySelector<HTMLInputElement>('input[aria-label="Local draft"]')!;
    draft.value = "UNSAVED_LOCAL_DRAFT";
    expect(localButton().getAttribute("aria-pressed")).toBe("true");
    expect(title?.querySelector('[data-project-location="local"]')).not.toBeNull();
    await act(async () => cloudButton().click());
    expect(onCloud).toHaveBeenCalledOnce();
    // Merely requesting Cloud does not relabel the still-local provider.
    expect(surface("local").hidden).toBe(false);
    expect(header?.getAttribute("data-workspace-kind")).toBeNull();
    expect(shell?.getAttribute("data-workspace-kind")).toBeNull();

    await renderCommittedLocation(true, onLocal, onCloud);
    expect(surface("local").hidden).toBe(true);
    expect(surface("cloud").hidden).toBe(false);
    expect(header?.getAttribute("data-workspace-kind")).toBe("cloud");
    expect(document.querySelector(".desktop-shell")).toBe(shell);
    expect(shell?.getAttribute("data-workspace-kind")).toBe("cloud");
    expect(cloudButton().getAttribute("aria-pressed")).toBe("true");
    expect(cloudButton().getAttribute("aria-current")).toBe("true");
    expect(localButton().getAttribute("aria-pressed")).toBe("false");
    expect(localButton().disabled).toBe(false);
    expect(title?.querySelector('[data-project-location="cloud"]')).not.toBeNull();
    expect(title?.getAttribute("aria-label")).toContain("Cloud Computer");
    expect(document.querySelector(".desktop-titlebar")).toBe(header);
    expect(document.querySelector(".desktop-titlebar-location-button")).toBe(title);
    expect(document.querySelector(".desktop-titlebar-centered-context .desktop-titlebar-workspace-name")?.textContent).toBe("To-Do-List");
    await act(async () => localButton().click());
    expect(onLocal).toHaveBeenCalledOnce();

    await renderCommittedLocation(false, onLocal, onCloud);
    expect(surface("cloud").hidden).toBe(true);
    expect(surface("local").hidden).toBe(false);
    expect(header?.getAttribute("data-workspace-kind")).toBeNull();
    expect(shell?.getAttribute("data-workspace-kind")).toBeNull();
    expect(localButton().getAttribute("aria-pressed")).toBe("true");
    expect(cloudButton().getAttribute("aria-pressed")).toBe("false");
    expect(title?.querySelector('[data-project-location="local"]')).not.toBeNull();
    expect(document.querySelector('input[aria-label="Local draft"]')).toBe(draft);
    expect(draft.value).toBe("UNSAVED_LOCAL_DRAFT");
  });

  it.each(["signed-out", "resolving", "attention", "available"] as const)("does not mistake %s association for an active Cloud provider", (cloudState) => {
    const state = appLocation(false, cloudState);
    expect(state.projectLocation).toMatchObject({ current: "local", cloudState });
    expect(state.surface).toBe("local");
    expect(state.chrome).toBe("local");
  });
});
