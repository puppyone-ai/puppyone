import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const catalogCss = readFileSync(
  new URL("../../../../src/features/cloud/access-points/styles/catalog-page.css", import.meta.url),
  "utf8",
);
const accessPointListCss = readFileSync(
  new URL("../../../../src/features/cloud/access-points/styles/access-point-list.css", import.meta.url),
  "utf8",
);
const catalogSource = readFileSync(
  new URL("../../../../src/features/cloud/access-points/components/AccessPointCatalogPage.tsx", import.meta.url),
  "utf8",
);
const routePageSource = readFileSync(
  new URL("../../../../src/features/cloud/access-points/pages/AccessPointRoutePage.tsx", import.meta.url),
  "utf8",
);
const routeRegistrySource = readFileSync(
  new URL("../../../../src/features/cloud/access-points/pages/accessPointRoutes.ts", import.meta.url),
  "utf8",
);
const routeOutletSource = readFileSync(
  new URL("../../../../src/features/cloud/routes/CloudProjectRouteOutlet.tsx", import.meta.url),
  "utf8",
);

describe("Cloud Connections visual architecture", () => {
  it("uses the same landing title system as Access and Automation", () => {
    const catalog = compact(readCssBlock(catalogCss, ".desktop-cloud-access-catalog"));
    const header = compact(readCssBlock(catalogCss, ".desktop-cloud-access-landing-header"));
    const title = compact(readCssBlock(catalogCss, ".desktop-cloud-access-landing-copy h1"));

    expect(catalog).toContain("padding: var(--desktop-cloud-page-padding-top) var(--desktop-cloud-page-padding-inline) var(--desktop-cloud-page-padding-bottom);");
    expect(header).toContain("align-items: flex-start;");
    expect(header).toContain("padding: 0 8px;");
    expect(title).toContain("font-size: var(--po-text-size-page-title, 20px);");
    expect(title).toContain("font-weight: 500;");
  });

  it("renders MCP, CLI, and Git through the exact Access Point list", () => {
    const list = compact(readCssBlock(accessPointListCss, ".desktop-cloud-access-point-list"));
    const row = compact(readCssBlock(accessPointListCss, ".desktop-cloud-access-point-row"));

    expect(list).toContain("gap: 7px;");
    expect(row).toContain("grid-template-columns: var(--po-control-size) minmax(0, 1fr) minmax(260px, 330px);");
    expect(row).toContain("border: 1px solid var(--po-border-subtle);");
    expect(catalogSource).toContain("AccessPointList");
    expect(routeRegistrySource).toContain('mcp: "mcp"');
    expect(routeRegistrySource).toContain('cli: "cli"');
    expect(routeRegistrySource).toContain('"git-sync": "git"');
    expect(routeOutletSource).toContain("getAccessPointCatalogKindForSection");
  });

  it("does not maintain a second visual implementation for Connection routes", () => {
    expect(routeOutletSource).not.toContain("CloudMcpSection");
    expect(routeOutletSource).not.toContain("CloudCliSection");
    expect(routeOutletSource).not.toContain("CloudGitSyncSection");
    expect(routePageSource).toContain("buildAccessPointProjection");
    expect(routePageSource).not.toContain("catalogFilterLocked");
    expect(routePageSource).not.toContain("catalogTitle");
  });
});

function readCssBlock(css: string, selector: string): string {
  const marker = `${selector} {`;
  const lineMarker = `\n${marker}`;
  const lineStart = css.indexOf(lineMarker);
  const start = css.startsWith(marker) ? 0 : lineStart >= 0 ? lineStart + 1 : -1;
  if (start < 0) throw new Error(`Missing CSS block for ${selector}`);
  const bodyStart = start + marker.length;
  const end = css.indexOf("\n}", bodyStart);
  if (end < 0) throw new Error(`Unclosed CSS block for ${selector}`);
  return css.slice(bodyStart, end);
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
