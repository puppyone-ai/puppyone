import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../../..");
const SOURCE_ROOTS = [
  path.join(REPOSITORY_ROOT, "src"),
  path.join(REPOSITORY_ROOT, "packages", "shared-ui", "src"),
];
const PUBLIC_ASSET_ROOT = path.join(REPOSITORY_ROOT, "public");

function filesIn(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(target) : [target];
  });
}

function sourceFiles(directory: string): string[] {
  return filesIn(directory)
    .filter((file) => /\.(tsx|jsx|ts|js)$/.test(file) && !file.endsWith(".d.ts"));
}

function findNativeTitleWrites(file: string) {
  const source = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const violations: string[] = [];
  const report = (node: ts.Node) => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    violations.push(`${path.relative(REPOSITORY_ROOT, file)}:${line}`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(sourceFile) === "title") {
      const opening = node.parent.parent;
      if (
        (ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening))
        && /^[a-z]/.test(opening.tagName.getText(sourceFile))
      ) report(node);
    }
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left)
      && node.left.name.text === "title"
    ) report(node);
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "setAttribute"
      && ts.isStringLiteral(node.arguments[0])
      && node.arguments[0].text === "title"
    ) report(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

describe("native title architecture", () => {
  it("keeps browser-native title bubbles out of product DOM", () => {
    const violations = SOURCE_ROOTS.flatMap(sourceFiles).flatMap(findNativeTitleWrites);
    expect(violations).toEqual([]);
  });

  it("keeps native title bubbles out of SVG assets", () => {
    const violations = filesIn(PUBLIC_ASSET_ROOT)
      .filter((file) => file.endsWith(".svg"))
      .filter((file) => /<title(?:\s|>)/i.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(REPOSITORY_ROOT, file));
    expect(violations).toEqual([]);
  });
});
