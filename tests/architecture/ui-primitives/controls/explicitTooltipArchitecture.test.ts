import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../../..");
const SOURCE_ROOTS = [
  path.join(REPOSITORY_ROOT, "src"),
  path.join(REPOSITORY_ROOT, "packages", "shared-ui", "src"),
];
const TOOLTIP_PRIMITIVE = path.join(
  REPOSITORY_ROOT,
  "packages",
  "shared-ui",
  "src",
  "primitives",
  "Tooltip.tsx",
);
const ARCHITECTURE_SCAN_TIMEOUT_MS = 15_000;

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(tsx|jsx|ts|js)$/.test(target) && !target.endsWith(".d.ts") ? [target] : [];
  });
}

function findDirectTooltipActivation(file: string) {
  if (file === TOOLTIP_PRIMITIVE) return [];
  const source = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: string[] = [];
  const report = (node: ts.Node) => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    violations.push(`${path.relative(REPOSITORY_ROOT, file)}:${line}`);
  };
  const tooltipDataName = (node: ts.Node | undefined) => {
    if (!node) return false;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return node.text.startsWith("data-tooltip");
    }
    return ts.isIdentifier(node) && node.text.startsWith("data-tooltip");
  };
  const tooltipDatasetName = (node: ts.Node | undefined) => {
    if (!node) return false;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return node.text.startsWith("tooltip");
    }
    return ts.isIdentifier(node) && node.text.startsWith("tooltip");
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isJsxAttribute(node)
      && node.name.getText(sourceFile).startsWith("data-tooltip")
    ) report(node);
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && (
        (
          ts.isPropertyAccessExpression(node.left)
          && node.left.name.text.startsWith("tooltip")
          && ts.isPropertyAccessExpression(node.left.expression)
          && node.left.expression.name.text === "dataset"
        )
        || (
          ts.isElementAccessExpression(node.left)
          && tooltipDatasetName(node.left.argumentExpression)
          && ts.isPropertyAccessExpression(node.left.expression)
          && node.left.expression.name.text === "dataset"
        )
      )
    ) report(node);
    if (
      ts.isPropertyAssignment(node)
      && tooltipDataName(node.name)
    ) report(node);
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "setAttribute"
      && ts.isStringLiteral(node.arguments[0])
      && node.arguments[0].text.startsWith("data-tooltip")
    ) report(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

describe("explicit tooltip architecture", () => {
  it("keeps Markdown controls and their portalled menus free of hover hint activation", () => {
    const markdownRoot = path.join(REPOSITORY_ROOT, "packages/shared-ui/src/editor/markdown");
    const violations = sourceFiles(markdownRoot).filter((file) => {
      const source = fs.readFileSync(file, "utf8");
      return /\bactivateTooltip\s*\(|<Tooltip\b/.test(source);
    }).map((file) => path.relative(REPOSITORY_ROOT, file));
    expect(violations).toEqual([]);
    expect(fs.readFileSync(path.join(markdownRoot, "MarkdownCodeMirrorEditor.tsx"), "utf8"))
      .toContain("disableTooltipHints(host)");
    expect(fs.readFileSync(path.join(markdownRoot, "MarkdownViewer.tsx"), "utf8"))
      .toContain("modeTooltipsEnabled={false}");
    expect(fs.readFileSync(path.join(markdownRoot, "features/table/tableContextMenu.ts"), "utf8"))
      .toContain("disableTooltipHints(menu)");
  });

  it("installs the native-title guard and the product-authored tooltip layer at startup", () => {
    const entry = fs.readFileSync(path.join(REPOSITORY_ROOT, "src/main.tsx"), "utf8");
    expect(entry).toContain("installNativeTitleSuppression()");
    expect(entry).toContain("<DesktopTooltipLayer />");
    expect(fs.readFileSync(path.join(REPOSITORY_ROOT, "src/styles.css"), "utf8"))
      .toContain('"./styles/tooltip.css"');
  });

  it("routes product tooltips through the shared opt-in API", () => {
    const violations = SOURCE_ROOTS.flatMap(sourceFiles).flatMap(findDirectTooltipActivation);
    expect(violations).toEqual([]);
  }, ARCHITECTURE_SCAN_TIMEOUT_MS);
});
