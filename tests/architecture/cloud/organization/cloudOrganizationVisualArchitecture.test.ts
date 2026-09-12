import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readSource("../../../../src/features/cloud/organization/organization.css");
const teamSource = readSource("../../../../src/features/cloud/organization/CloudOrganizationTeamPage.tsx");
const billingSource = readSource("../../../../src/features/cloud/organization/CloudOrganizationBillingPage.tsx");

describe("Cloud organization visual architecture", () => {
  it("shares the standard Cloud catalog shell and restrained heading hierarchy", () => {
    const shell = compact(readCssBlock(styles, ".desktop-cloud-org-shell"));
    const title = compact(readCssBlock(styles, ".desktop-cloud-org-header-copy h1"));
    const description = compact(readCssBlock(styles, ".desktop-cloud-org-header-copy p"));
    const content = compact(readCssBlock(styles, ".desktop-cloud-org-content"));

    expect(shell).toContain("width: min(100%, 1760px);");
    expect(shell).toContain("padding: var(--desktop-cloud-catalog-padding-top) var(--desktop-cloud-page-padding-inline) var(--desktop-cloud-page-padding-bottom);");
    expect(title).toContain("font-size: var(--po-text-size-page-title, 20px);");
    expect(title).toContain("font-weight: 500;");
    expect(description).toContain("font-size: var(--po-text-size-body-lg, 14px);");
    expect(description).toContain("font-weight: 400;");
    expect(content).toContain("width: min(100%, 980px);");
    expect(teamSource).toContain('className="desktop-cloud-org-canvas"');
    expect(teamSource).toContain('className="desktop-cloud-org-header-copy"');
  });

  it("uses quiet shared surfaces for both member and billing content", () => {
    const sharedCard = compact(readCssBlock(styles, [
      ".desktop-cloud-org-card",
      ".desktop-cloud-billing-current",
      ".desktop-cloud-billing-plan-card",
    ].join(",\n")));
    const usageCard = compact(readCssBlock(styles, ".desktop-cloud-billing-usage-card"));

    expect(sharedCard).toContain("border: 1px solid var(--po-border-subtle);");
    expect(sharedCard).toContain("border-radius: 9px;");
    expect(sharedCard).toContain("background: transparent;");
    expect(sharedCard).not.toContain("box-shadow:");
    expect(usageCard).toContain("border: 1px solid var(--po-border-subtle);");
    expect(usageCard).toContain("background: transparent;");
    expect(styles).not.toMatch(/font-weight:\s*(?:600|6[1-9]0|700)\b/);
    expect(billingSource).toContain("<CloudOrganizationPageShell");
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
