/** @vitest-environment happy-dom */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopWindowChrome } from "../../../../src/components/DesktopWindowChrome";
import { DesktopTitlebarContext } from "../../../../src/features/app-shell/DesktopTitlebarContext";
import { DesktopWorkspaceLocationSurface } from "../../../../src/features/app-shell/DesktopWorkspaceLocationSurface";
import type { DesktopProjectLocation } from "../../../../src/features/app-shell/DesktopWorkspaceSwitcher";
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
const headerBindings: string[] = [];
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(app) === "projectLocation") {
    locationBinding = node.initializer?.getText(app) ?? "";
  }
  if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
    const name = node.tagName.getText(app);
    const propName = name === "DesktopWorkspaceLocationSurface" ? "location"
      : name === "DesktopTitlebarContext" || name === "DesktopProjectLocationControls" ? "projectLocation" : null;
    if (propName) {
      const prop = node.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(app) === propName);
      if (prop && ts.isJsxAttribute(prop) && prop.initializer && ts.isJsxExpression(prop.initializer)) {
        const expression = prop.initializer.expression?.getText(app) ?? "";
        if (propName === "location") surfaceBinding = expression;
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
  expect(headerBindings).toEqual(["projectLocation", "projectLocation"]);
  const compiled = ts.transpileModule(`const projectLocation = ${locationBinding};
    ({ projectLocation, surface: ${surfaceBinding} });`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(compiled, { cloudEnabled, cloudWorkspaceActive, projectCloudLocationState: cloudState }) as {
    projectLocation: DesktopProjectLocation | undefined; surface: "local" | "cloud";
  };
}

let root: Root | null = null;
const workspace = { id: "todo", name: "To-Do-List", path: "/fixture/todo", status: "recording" as const };
const menuRef = createRef<HTMLDivElement>();
const branchRef = createRef<HTMLDivElement>();
const noop = () => undefined;
const localButton = () => document.querySelector<HTMLButtonElement>('button[data-project-location="local"]')!;
const cloudButton = () => document.querySelector<HTMLButtonElement>('button[data-project-location="cloud"]')!;
const surface = (name: string) => document.querySelector<HTMLElement>(`[data-workspace-location="${name}"]`)!;

async function renderCommittedLocation(active: boolean, onLocal = vi.fn(), onCloud = vi.fn()) {
  if (!root) { const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
  const state = appLocation(active);
  await act(async () => root!.render(withTestLocalization(<>
    <DesktopWindowChrome centeredContext={<DesktopTitlebarContext compactProjectMenu
      activeGitStatus={null} showBranchSwitcher={false} branchSwitcherOpen={false} branchSwitcherRef={branchRef}
      gitStatusLoading={false} gitOperationLoading={null} localBranches={[]} remoteBranches={[]}
      workspace={workspace} workspaceFolders={[]} multiRootWorkspacesEnabled={false} availableProjects={[]}
      projectLocation={state.projectLocation} cloudProject={{ id: "cloud-todo" }}
      workspaceSwitcherOpen workspaceSwitcherRef={menuRef}
      onCheckoutBranch={async () => false} onCloseBranchSwitcher={noop} onCloseWorkspaceSwitcher={noop}
      onAddProject={noop} onAddExistingProject={noop} onToggleBranchSwitcher={noop} onToggleWorkspaceSwitcher={noop}
      onViewLocal={onLocal} onViewCloud={onCloud} />} />
    <DesktopWorkspaceLocationSurface location={state.surface}
      local={<input aria-label="Local draft" defaultValue="LOCAL_ONLY" />}
      cloud={<div data-cloud-native="true">CLOUD_ONLY</div>} />
  </>)));
}

afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("production App location wiring", () => {
  it.each([false, true, false])("binds the Header and body to the same committed Cloud state (%s)", (active) => {
    const state = appLocation(active);
    expect(state.surface).toBe(active ? "cloud" : "local");
    expect(state.projectLocation?.current).toBe(state.surface);
  });

  it("updates the Header icon, menu selection and return action when Cloud content becomes visible", async () => {
    const onLocal = vi.fn(), onCloud = vi.fn();
    await renderCommittedLocation(false, onLocal, onCloud);
    const header = document.querySelector(".desktop-titlebar");
    const title = document.querySelector(".desktop-titlebar-workspace-button");
    const draft = document.querySelector<HTMLInputElement>('input[aria-label="Local draft"]')!;
    draft.value = "UNSAVED_LOCAL_DRAFT";
    expect(localButton().getAttribute("aria-pressed")).toBe("true");
    expect(title?.querySelector('[data-project-location="local"]')).not.toBeNull();
    await act(async () => cloudButton().click());
    expect(onCloud).toHaveBeenCalledOnce();
    // Merely requesting Cloud does not relabel the still-local provider.
    expect(surface("local").hidden).toBe(false);

    await renderCommittedLocation(true, onLocal, onCloud);
    expect(surface("local").hidden).toBe(true);
    expect(surface("cloud").hidden).toBe(false);
    expect(cloudButton().getAttribute("aria-pressed")).toBe("true");
    expect(cloudButton().getAttribute("aria-current")).toBe("true");
    expect(localButton().getAttribute("aria-pressed")).toBe("false");
    expect(localButton().disabled).toBe(false);
    expect(title?.querySelector('[data-project-location="cloud"]')).not.toBeNull();
    expect(title?.getAttribute("aria-label")).toContain("Cloud");
    expect(document.querySelector(".desktop-titlebar")).toBe(header);
    expect(document.querySelector(".desktop-titlebar-workspace-button")).toBe(title);
    expect(document.querySelector(".desktop-titlebar-centered-context .desktop-titlebar-workspace-name")?.textContent).toBe("To-Do-List");
    await act(async () => localButton().click());
    expect(onLocal).toHaveBeenCalledOnce();

    await renderCommittedLocation(false, onLocal, onCloud);
    expect(surface("cloud").hidden).toBe(true);
    expect(surface("local").hidden).toBe(false);
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
  });
});
