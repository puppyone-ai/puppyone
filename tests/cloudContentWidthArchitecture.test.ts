import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sharedShell = readSource("../src/features/cloud/styles/sidebar-shell.css");
const overview = readSource("../src/features/cloud/sections/overview/styles/base.css");
const connections = readSource("../src/features/cloud/access-points/styles/catalog-page.css");
const settings = readSource("../src/features/cloud/sections/settings/settings.css");
const automation = readSource("../src/features/automation/styles/shell-and-catalog.css");
const activation = readSource("../src/features/cloud/components/mcp-activation.css");
const activationComponent = readSource("../src/features/cloud/components/CloudActivationHero.tsx");
const overviewIllustration = readSource("../src/features/cloud/components/CloudOverviewHostingIllustration.tsx");
const cloudSignIn = readSource("../src/features/cloud/auth/cloud-sign-in.css");
const organization = readSource("../src/features/cloud/organization/organization.css");

describe("Cloud content width architecture", () => {
  it("shares the editor-scale 900px reading rail across project pages", () => {
    expect(sharedShell).toContain("--desktop-cloud-content-max-width: 900px;");
    expect(sharedShell).toContain("width: min(100%, var(--desktop-cloud-content-max-width));");

    const constrainedWidth = "width: min(100%, var(--desktop-cloud-content-max-width, 900px));";
    for (const stylesheet of [overview, connections, settings, automation, activation]) {
      expect(stylesheet).toContain(constrainedWidth);
      expect(stylesheet).not.toContain("width: min(100%, 1760px);");
    }
  });

  it("derives every Cloud catalog top inset from the Team and Billing shell rhythm", () => {
    expect(sharedShell).toContain("--desktop-cloud-shell-padding-top: var(--desktop-utility-page-padding-top);");
    expect(sharedShell).toContain("--desktop-cloud-catalog-padding-top: 44px;");
    expect(sharedShell).toContain("--desktop-cloud-page-padding-top: calc(");

    const alignedPadding = [
      "var(--desktop-cloud-page-padding-top)",
      "var(--desktop-cloud-page-padding-inline)",
      "var(--desktop-cloud-page-padding-bottom)",
    ].join("\n    ");
    for (const stylesheet of [overview, connections, settings, automation]) {
      expect(stylesheet).toContain(alignedPadding);
      expect(stylesheet).not.toContain("padding: 44px clamp(28px, 4.6vw, 44px) 56px;");
    }

    expect(organization).toContain("var(--desktop-cloud-catalog-padding-top)");
    expect(sharedShell).toContain(":not(.desktop-cloud-landing-main-view):not(.desktop-cloud-automation-main-view)");
  });

  it("keeps activation copy and artwork compact and responds to the content pane", () => {
    expect(cloudSignIn).toContain("container: cloud-auth / inline-size;");
    expect(activation).toContain(".desktop-cloud-mcp-activation.is-connection");
    expect(activation).toContain("--desktop-cloud-activation-max-width: 520px;");
    expect(activation).toContain("--desktop-cloud-activation-artwork-slot-size: 236px;");
    expect(activation).toContain("--desktop-cloud-activation-artwork-slot-height: 150px;");
    expect(activation).toContain("max-width: var(--desktop-cloud-activation-max-width);");
    expect(activation).toContain("grid-template-columns: minmax(0, 440px);");
    expect(activation).toContain("grid-template-rows: var(--desktop-cloud-activation-artwork-slot-height) auto;");
    expect(activation).toContain("grid-row: 1;");
    expect(activation).toContain("grid-row: 2;");
    expect(activation).toContain("justify-self: start;");
    expect(activation).toContain("font-size: var(--po-text-size-page-title, 20px);");
    expect(activation).toContain("font-weight: 600;");
    expect(activation).not.toMatch(/font-size:\s*[^;]*\d+\.\d+(?:px|em|rem|vw)/);
    expect(activation).not.toContain("font-size: 25px;");
    expect(activation).toContain(".desktop-cloud-activation-illustration-frame.is-overview");
    expect(activation).toContain("width: 150px;");
    expect(activation).toContain(".desktop-cloud-activation-illustration-frame:not(.is-connection):not(.is-overview)");
    expect(activation).toContain("width: 110px;");
    expect(activation).toContain("@container (max-width: 820px)");
    expect(activation).toContain("@container (max-width: 680px)");
    expect(activation).toContain("@container (max-width: 420px)");
    expect(activation).toContain(".desktop-cloud-activation-illustration-frame.is-connection");
    expect(activation).toContain("--desktop-cloud-connection-art-scale: 0.56;");
    expect(activation).toContain("--desktop-cloud-overview-art-scale: 0.56;");
    expect(activation).toContain("--desktop-cloud-secondary-art-scale: 0.34;");
    expect(activation).toContain("--desktop-cloud-activation-artwork-slot-size: 220px;");
    expect(activation).toContain("--desktop-cloud-connection-art-scale: 0.52;");
    expect(activation).toContain("aspect-ratio: auto;");
    expect(activation).toContain("overflow: hidden;");
    expect(activation).toContain("contain: layout paint;");
    expect(activation).toContain("position: absolute;");
    expect(activation).toContain("left: 50%;");
    expect(activation).toContain("top: 50%;");
    expect(activation).toContain("transform: translate(-50%, -50%) scale(var(--desktop-cloud-connection-art-scale));");
    expect(activation).toContain("grid-template-columns: 166px 54px 180px;");
    expect(activation).toContain("grid-template-columns: 166px 54px 176px;");
    expect(activation).toContain("background: linear-gradient(to right, #d8d8d5 0%, #c9c9c6 78%, #bdbdb9 100%);");
    expect(activation).not.toContain("grid-template-rows: 146px 54px 226px;");
    expect(activation).toContain(".desktop-cloud-activation-illustration-frame.is-overview");
    expect(activation).toContain("width: var(--desktop-cloud-activation-artwork-slot-size);");
    expect(activation).toContain("height: auto;");
    expect(activation).toContain("isolation: isolate;");
    expect(activation).toContain(".desktop-cloud-overview-hosting-art");
    expect(activation).toContain("color-mix(in srgb, var(--po-text) 32%, transparent)");
    expect(activation).toContain(".desktop-cloud-overview-hosting-folder-mark");
    expect(activation).toContain(".desktop-cloud-overview-hosting-folder-shape");
    expect(activation).toContain(".desktop-cloud-overview-hosting-folder-logo");
    expect(activationComponent).toContain("CloudOverviewHostingIllustration");
    expect(overviewIllustration).toContain('viewBox="0 0 320 260"');
    expect(overviewIllustration).toContain("desktop-cloud-overview-hosting-cloud");
    expect(overviewIllustration).toContain("CloudPublishFolderMark");
    expect(overviewIllustration).toContain("McpLogoIcon");
    expect(overviewIllustration).toContain("desktop-cloud-overview-hosting-folder-mark");
    expect(overviewIllustration).toContain("desktop-cloud-overview-hosting-status");
    expect(overviewIllustration).not.toContain("linearGradient");
    expect(activationComponent).not.toContain("desktop-cloud-activation-overview-cloud");
    expect(activationComponent).not.toContain("desktop-cloud-activation-overview-folder");
    expect(activationComponent).not.toContain("cloud-homepage-hosting-hero-v1.png");
    expect(activation).not.toContain("desktop-cloud-activation-overview-link");
    expect(activation).not.toContain("grid-template-columns: minmax(0, 360px) var(--desktop-cloud-activation-artwork-slot-size);");
    expect(activation).not.toContain(".desktop-cloud-mcp-activation.is-mcp {");
    expect(activation).not.toMatch(/\.desktop-cloud-activation-illustration-frame\s*\{[^}]*place-items:/s);
    expect(activation).not.toContain("@media (max-width: 760px)");
    expect(activation).not.toContain("margin-bottom: -");
    expect(activationComponent).toContain('desktop-cloud-mcp-phone is-cropped');
    expect(activationComponent).not.toContain("desktop-cloud-mcp-phone-home-indicator");
    expect(activation).toContain("border-radius: 28px;");
    expect(activation).toContain(".desktop-cloud-mcp-phone.is-cropped");
    expect(activation).toContain("border-bottom: 0;");
    expect(activation).toContain("border-radius: 28px 28px 0 0;");
  });
});

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
