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
import type { ProjectHomeItem } from "../../../../src/lib/workspaceHomeModel";
import { withTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/platform/useDesktopPlatformCapabilities", () => ({
  useDesktopPlatformCapabilities: () => ({ platform: "macos", windowChrome: { mode: "overlay" } }),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Compile the production App bindings, not a fixture's independently authored
// value. A previous native smoke set its own location and therefore missed an
// App prop that disagreed with the body.
const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
const app = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let locationBinding = "";
let surfaceBinding = "";
let chromeBinding = "";
const titlebarProps: string[] = [];
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(app) === "workspaceLocation") {
    locationBinding = node.initializer?.getText(app) ?? "";
  }
  if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
    const name = node.tagName.getText(app);
    for (const attribute of node.attributes.properties) {
      if (!ts.isJsxAttribute(attribute)) continue;
      const prop = attribute.name.getText(app);
      const expression = attribute.initializer && ts.isJsxExpression(attribute.initializer)
        ? attribute.initializer.expression?.getText(app) ?? "" : "";
      if (name === "DesktopWorkspaceLocationSurface" && prop === "location") surfaceBinding = expression;
      if (name === "DesktopCloudShell" && prop === "workspaceLocation") chromeBinding = expression;
      if (name === "DesktopTitlebarContext") titlebarProps.push(prop);
    }
  }
  ts.forEachChild(node, visit);
}
visit(app);

function appLocation(cloudWorkspaceActive: boolean) {
  expect(locationBinding).not.toBe("");
  const compiled = ts.transpileModule(`const workspaceLocation = ${locationBinding};
    ({ surface: ${surfaceBinding}, chrome: ${chromeBinding} });`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(compiled, { cloudWorkspaceActive }) as { surface: "local" | "cloud"; chrome: "local" | "cloud" };
}

let root: Root | null = null;
const workspace = { id: "todo", name: "To-Do-List", path: "/fixture/todo", status: "recording" as const };
const cloudWorkspace = { id: "cloud-todo", name: "To-Do-List", path: "puppyone-cloud:cloud-todo", projectId: "cloud-todo",
  status: "recording" as const };
const projectItems: ProjectHomeItem[] = [
  { id: "local:/fixture/todo", label: "To-Do-List", localPath: "/fixture/todo", linkedCloudProject: { id: "cloud-todo", name: "To-Do-List" } },
  { id: "cloud:cloud-todo", label: "To-Do-List", localPath: "", cloudProjectId: "cloud-todo" },
];
const menuRef = createRef<HTMLDivElement>();
const noop = () => undefined;
const surface = (name: string) => document.querySelector<HTMLElement>(`[data-workspace-location="${name}"]`)!;

async function renderCommittedLocation(active: boolean, onSelectProject = vi.fn(), onSelectCloudProject = vi.fn(), open = false) {
  if (!root) { const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
  const state = appLocation(active);
  await act(async () => root!.render(withTestLocalization(
    <DesktopCloudShell workspaceLocation={state.chrome} titlebarCenteredSlot={<DesktopTitlebarContext titlebarLabel={workspace.name}
      workspace={active ? cloudWorkspace : workspace} workspaceFolders={[]} multiRootWorkspacesEnabled={false}
      projectItems={projectItems} open={open} refObject={menuRef} onClose={noop} onToggle={noop}
      onSelectProject={onSelectProject} onSelectCloudProject={onSelectCloudProject} />}>
    <DesktopWorkspaceLocationSurface location={state.surface}
      local={<input aria-label="Local draft" defaultValue="LOCAL_ONLY" />}
      cloud={<div data-cloud-native="true">CLOUD_ONLY</div>} />
    </DesktopCloudShell>)));
}

afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("production App location wiring", () => {
  it.each([false, true, false])("binds the Header and body to the same shown project (%s)", (active) => {
    const state = appLocation(active);
    expect(state.surface).toBe(active ? "cloud" : "local");
    expect(state.chrome).toBe(state.surface);
    expect(surfaceBinding).toBe("workspaceLocation");
    expect(chromeBinding).toBe("workspaceLocation");
  });

  it("never offers to switch one project between this computer and the Cloud (ADR-001)", () => {
    expect(titlebarProps).not.toEqual(expect.arrayContaining(["projectLocation"]));
    expect(titlebarProps).not.toContain("onViewLocal");
    expect(titlebarProps).not.toContain("onViewCloud");
    expect(appSource).not.toMatch(/DesktopProjectLocation|useRepositoryCloudWorkspaceSwitch|RepositoryCloudSwitchGate/);
  });

  it("goes to the Cloud project and back through the project menu, keeping the folder's draft", async () => {
    const onSelectProject = vi.fn(), onSelectCloudProject = vi.fn();
    await renderCommittedLocation(false, onSelectProject, onSelectCloudProject, true);
    const header = document.querySelector(".desktop-titlebar");
    const shell = document.querySelector(".desktop-shell");
    const draft = document.querySelector<HTMLInputElement>('input[aria-label="Local draft"]')!;
    draft.value = "UNSAVED_LOCAL_DRAFT";
    expect(document.querySelector(".desktop-titlebar-location-button, [data-project-location-controls]")).toBeNull();
    const rows = [...document.querySelectorAll<HTMLElement>(".desktop-project-switcher-row")];
    expect(rows.map((row) => row.dataset.projectLocation)).toEqual(["local", "cloud"]);
    await act(async () => rows[1]!.querySelector<HTMLButtonElement>("button")!.click());
    expect(onSelectCloudProject).toHaveBeenCalledWith("cloud-todo");

    await renderCommittedLocation(true, onSelectProject, onSelectCloudProject);
    expect(surface("local").hidden).toBe(true);
    expect(surface("cloud").hidden).toBe(false);
    expect(header?.getAttribute("data-workspace-kind")).toBe("cloud");
    expect(document.querySelector(".desktop-shell")).toBe(shell);
    expect(document.querySelector(".desktop-titlebar")).toBe(header);

    await renderCommittedLocation(false, onSelectProject, onSelectCloudProject);
    expect(surface("cloud").hidden).toBe(true);
    expect(surface("local").hidden).toBe(false);
    expect(header?.getAttribute("data-workspace-kind")).toBeNull();
    expect(shell?.getAttribute("data-workspace-kind")).toBeNull();
    expect(document.querySelector('input[aria-label="Local draft"]')).toBe(draft);
    expect(draft.value).toBe("UNSAVED_LOCAL_DRAFT");
  });
});
