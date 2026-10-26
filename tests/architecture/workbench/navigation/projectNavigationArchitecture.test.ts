import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
const app = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const surfaces = ["ProjectSwitcherRail", "DesktopTitlebarContext", "AccountCloudWorkspaceSurface"];
function bindings(component: string, prop: string) {
  const values: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(app) === component) {
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxAttribute(attribute) && attribute.name.getText(app) === prop
          && attribute.initializer && ts.isJsxExpression(attribute.initializer)) {
          values.push(attribute.initializer.expression?.getText(app) ?? "");
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(app);
  return values;
}

describe("one project navigation policy across shell surfaces", () => {
  it("binds every switcher to the same Local/Cloud commands and pending selection", () => {
    for (const surface of surfaces) {
      expect(bindings(surface, "onSelectProject")).toEqual(["selectProject"]);
      expect(bindings(surface, "onSelectCloudProject")).toEqual(["selectCloudProject"]);
      expect(bindings(surface, "pendingProject")).toEqual(["projectNavigation.pending"]);
    }
    expect(source).not.toContain("openCloudProjectInNewWindow");
    expect(source).not.toContain('placement: "dedicated-window"');
  });
  it("routes both New workspace actions to the shared launcher", () => {
    expect(bindings("ProjectSwitcherRail", "onCreateNew")).toEqual(["openProjectLauncher"]);
    expect(bindings("DesktopTitlebarContext", "onCreateProject")).toEqual(["openProjectLauncher"]);
    expect(bindings("AccountCloudWorkspaceSurface", "onCreateProject")).toEqual(["openProjectLauncher"]);
    expect(bindings("Homepage", "projectEntryController")).toEqual(["projectEntryFlow"]);
  });
});
