import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("project initialization ownership", () => {
  it("keeps file generation out of the mounted workspace and editor open intent", () => {
    const surface = source("src/features/app-shell/DesktopDataWorkspaceSurface.tsx");
    const openIntent = source("src/features/app-shell/useInitialProjectDocument.ts");
    expect(surface).not.toMatch(/createStarterDocument|starterDocumentAutoCreate|EmptyWorkspaceOnboardingDialog/);
    expect(openIntent).not.toMatch(/createFile\(|writeFile\(|localStorage/);
    expect(openIntent).toContain("qualifyDataResourcePath");
  });

  it("shares one materializer between project templates and Slides", () => {
    expect(source("electron/main/project-initialization-service.mjs")).toContain('local-api/templates/materialize.mjs');
    expect(source("local-api/workspace-templates.mjs")).toContain('./templates/materialize.mjs');
    expect(source("local-api/workspace-templates.mjs")).not.toContain("fs.rename(");
  });

  it("packages the offline template content and safe publication primitive", () => {
    const pkg = JSON.parse(source("package.json"));
    expect(pkg.build.files).toContain("local-api/**");
    expect(pkg.build.asarUnpack).toContain("local-api/templates/native/*.node");
    expect(pkg.scripts.build).toContain("build:native-templates");
    expect(pkg.scripts.dev).toContain("build:native-templates");
  });
});
function source(relativePath: string) {
  return readFileSync(new URL(`../../../../${relativePath}`, import.meta.url), "utf8");
}
