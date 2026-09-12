import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboardCss = readSource("../../../../src/features/cloud/sections/overview/styles/dashboard-grid.css");
const baseCss = readSource("../../../../src/features/cloud/sections/overview/styles/base.css");
const projectIdentityCss = readSource("../../../../src/features/cloud/sections/overview/styles/project-identity.css");
const resourceCss = readSource("../../../../src/features/cloud/sections/overview/styles/resource-cards.css");
const statusCss = readSource("../../../../src/features/cloud/sections/overview/styles/status-cards.css");
const dashboardSource = readSource("../../../../src/features/cloud/sections/overview/OverviewDashboard.tsx");
const overviewSource = readSource("../../../../src/features/cloud/sections/overview/OverviewSection.tsx");

describe("Cloud Overview visual architecture", () => {
  it("makes the file table the full-width primary Overview surface", () => {
    const layout = compact(readCssBlock(dashboardCss, ".desktop-cloud-overview-dashboard"));

    expect(layout).toContain("display: block;");
    expect(layout).toContain("width: 100%;");
    expect(layout).toContain("margin-top: 30px;");
    expect(dashboardSource).not.toContain("OverviewSummaryCard");
    expect(dashboardSource).not.toContain("desktop-cloud-overview-summary-grid");
    expect(overviewSource).toContain("desktop-cloud-overview-header-facts");
    expect(overviewSource).not.toContain("CloudWorkspaceLoadingState");
    expect(overviewSource).toContain("const initialLoading = loading && !hasOverviewData;");
  });

  it("uses one rounded file frame without filters or extra headers", () => {
    const files = compact(readCssBlock(resourceCss, ".desktop-cloud-overview-files"));

    expect(files).toContain("border: 1px solid var(--po-border-subtle);");
    expect(files).toContain("border-radius: 10px;");
    expect(files).toContain("overflow: hidden;");
    expect(resourceCss).toContain(".desktop-cloud-overview-file-row {\n  min-height: 36px;");
    expect(resourceCss).toContain("min-height: 36px;\n  border-bottom: 1px solid var(--po-border-subtle);");
    expect(resourceCss).toContain(".desktop-cloud-overview-file-row:last-child");
    expect(dashboardSource).not.toContain("desktop-cloud-overview-file-toolbar");
    expect(dashboardSource).not.toContain("desktop-cloud-overview-file-column-labels");
    expect(dashboardSource).not.toContain("OverviewFileSortKey");
    expect(dashboardCss).not.toContain("desktop-cloud-overview-file-search");
    expect(dashboardSource).not.toContain("desktop-cloud-overview-file-activity-header");
    expect(resourceCss).not.toContain("desktop-cloud-overview-file-activity-header");
    expect(dashboardSource).not.toContain("desktop-cloud-overview-files-header");
    expect(dashboardSource).not.toContain("cloud.overview.filesLabel");
    expect(dashboardSource).toContain("desktop-cloud-overview-file-row skeleton");
    expect(resourceCss).toContain("desktop-cloud-overview-file-skeleton-name");
  });

  it("renders compact entries with modification time and product file icons", () => {
    const name = compact(readCssBlock(resourceCss, ".desktop-cloud-overview-file-name"));
    const metadata = compact(readCssBlock(resourceCss, ".desktop-cloud-overview-file-modified"));

    expect(name).toContain("font-size: var(--po-type-ui-meta, 13px);");
    expect(name).toContain("font-weight: 500;");
    expect(metadata).toContain("font-size: var(--po-type-ui-caption, 12px);");
    expect(metadata).toContain("font-weight: 400;");
    expect(dashboardSource).toContain("FileGlyphIcon");
    expect(dashboardSource).toContain("getCloudOverviewEntryUpdatedAt(entry, history)");
    expect(dashboardSource).not.toContain("formatBytes(entry.size_bytes");
    expect(dashboardSource).not.toContain("desktop-cloud-overview-file-size");
    expect(dashboardSource).not.toMatch(/\bFile\b.*from "lucide-react"/);
    expect(dashboardSource).not.toMatch(/\bFolder\b.*from "lucide-react"/);
  });

  it("gives storage a full-width unlabeled track above three quiet facts", () => {
    const header = compact(readCssBlock(baseCss, ".desktop-cloud-overview-landing-header"));
    const facts = compact(readCssBlock(statusCss, ".desktop-cloud-overview-header-facts"));
    const fact = compact(readCssBlock(statusCss, ".desktop-cloud-overview-header-fact"));
    const storage = compact(readCssBlock(statusCss, ".desktop-cloud-overview-project-storage"));
    const track = compact(readCssBlock(statusCss, ".desktop-cloud-overview-project-storage-track"));
    const path = compact(readCssBlock(projectIdentityCss, ".desktop-cloud-overview-path-fact"));
    const titleRow = compact(readCssBlock(baseCss, ".desktop-cloud-overview-title-row"));

    expect(header).toContain("display: grid;");
    expect(header).toContain("width: 100%;");
    expect(facts).toContain("width: 100%;");
    expect(facts).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(fact).toContain("border-inline-start: 1px solid var(--po-border-subtle);");
    expect(storage).toContain("width: 100%;");
    expect(track).toContain("height: 5px;");
    expect(statusCss).toContain("desktop-cloud-overview-value-skeleton");
    expect(statusCss).toContain("desktop-cloud-overview-project-storage.is-loading");
    expect(path).toContain("width: auto;");
    expect(titleRow).toContain("align-items: center;");
    expect(overviewSource.match(/<CloudOverviewHeaderFact/g)).toHaveLength(2);
    expect(overviewSource).toContain("<CloudOverviewStorageMeter");
    expect(overviewSource).toContain('label={t("cloud.overview.activeConnections")}');
    expect(overviewSource).toContain("<CloudOverviewPathFact");
    expect(overviewSource.indexOf("<CloudOverviewStorageMeter")).toBeLessThan(
      overviewSource.indexOf("desktop-cloud-overview-header-side"),
    );
    expect(overviewSource).not.toContain("desktop-cloud-overview-project-storage-summary");
    expect(overviewSource).toContain("desktop-cloud-overview-title-row");
    expect(overviewSource).not.toContain("getCloudRoute(\"git-sync\").icon");
    expect(overviewSource).not.toContain("desktop-cloud-overview-landing-mark");
  });
});

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

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
