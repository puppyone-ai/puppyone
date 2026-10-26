import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The reach path is a second Header, not a second Header *and* a second set of
 * conditions scattered through the composition root. These assertions read the
 * production bindings out of `App.tsx`, because a component test can prove the
 * new Header renders while the App still wires the old one.
 */
const source = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
const app = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function attribute(element: string, name: string): string {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      if (node.tagName.getText(app) === element) {
        for (const property of node.attributes.properties) {
          if (!ts.isJsxAttribute(property) || property.name.getText(app) !== name) continue;
          const initializer = property.initializer;
          found.push(initializer && ts.isJsxExpression(initializer)
            ? initializer.expression?.getText(app) ?? "" : initializer?.getText(app) ?? "");
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(app);
  if (found.length !== 1) throw new Error(`Expected one ${element} ${name} binding, found ${found.length}`);
  return found[0]!.replace(/\s+/gu, " ");
}

function declaration(name: string): string {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(app) === name) {
      found.push(node.initializer?.getText(app).replace(/\s+/gu, " ") ?? "");
    }
    ts.forEachChild(node, visit);
  };
  visit(app);
  if (found.length !== 1) throw new Error(`Expected one ${name} declaration, found ${found.length}`);
  return found[0]!;
}

function property(name: string): string {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(app) === name) {
      found.push(node.initializer.getText(app).replace(/\s+/gu, " "));
    }
    ts.forEachChild(node, visit);
  };
  visit(app);
  if (found.length !== 1) throw new Error(`Expected one ${name} property, found ${found.length}`);
  return found[0]!;
}

describe("Header project reach bindings", () => {
  it("decides once in the composition root and hands the Header a prepared context", () => {
    expect(source.split("useProjectReachExperience()").length - 1).toBe(1);
    expect(attribute("DesktopTitlebarContext", "projectReach")).toBe("projectReach");
  });

  it("states nothing at all while Puppyone Cloud is off, like the established control", () => {
    expect(declaration("projectReach"))
      .toContain("projectReachEnabled && shareOnboardingEnabled && cloudEnabled");
  });

  it("makes the reach control the only Cloud entry while the Header states the Project", () => {
    // The reach control stands on the Header only while the Header is the
    // Project surface. Once the Project rail owns the Project the control is
    // gone, so the established share entry has to come back with it.
    expect(declaration("reachStatedInHeader")).toBe("Boolean(projectReach) && !railOwnsProject");
    expect(attribute("DesktopTitlebarActions", "shareEnabled"))
      .toBe("!cloudHeaderActive && shareOnboardingEnabled && !reachStatedInHeader");
    expect(attribute("DesktopWorkspaceContent", "cloudLocationControls"))
      .toContain("!projectReachEnabled");
  });

  it("keeps repository distance out of the Header's changes entry", () => {
    expect(property("gitChangesStatus"))
      .toBe("projectReachEnabled ? reachHeaderChangesStatus(gitTitlebarStatus) : gitTitlebarStatus");
  });

  it("leaves the established Header components free of the experiment", () => {
    for (const file of [
      "src/components/DesktopProjectLocationSwitcher.tsx",
      "src/features/app-shell/DesktopTitlebarActions.tsx",
      "src/features/app-shell/headerElements.tsx",
      "src/features/source-control/gitTitlebarStatus.ts",
    ]) {
      const established = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(established).not.toContain("projectReach");
      expect(established).not.toContain("useProjectReachExperience");
    }
  });
});
