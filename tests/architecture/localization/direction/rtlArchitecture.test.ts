import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const logicalUiStyles = [
  "../../../../src/features/automation/automation.css",
  "../../../../src/features/automation/automation-dialog.css",
  "../../../../src/features/cloud/organization/organization.css",
  "../../../../src/features/cloud/auth/cloud-auth-card.css",
  "../../../../src/features/cloud/auth/cloud-sign-in.css",
  "../../../../src/features/cloud/sections/access/styles/scope-settings.css",
  "../../../../src/features/cloud/sections/access/styles/scope-detail.css",
  "../../../../src/features/cloud/sections/access/styles/method-card.css",
  "../../../../src/features/cloud/sections/access/styles/permissions.css",
  "../../../../src/features/cloud/sections/access/styles/create-access-dialog.css",
  "../../../../src/features/cloud/sections/access/styles/responsive.css",
  "../../../../src/features/desktop-agent/ui/styles/activities.css",
  "../../../../src/features/desktop-agent/ui/styles/blocking.css",
  "../../../../src/features/desktop-agent/ui/styles/composer.css",
  "../../../../src/features/desktop-agent/ui/styles/transcript.css",
  "../../../../src/features/plugins/plugins.css",
  "../../../../packages/shared-ui/src/styles/editor/puppyflow-editor.css",
  "../../../../src/styles/settings-controls.css",
  "../../../../src/styles/settings-view.css",
  "../../../../src/styles/settings.css",
] as const;

describe("RTL architecture", () => {
  it("keeps application UI spacing and borders direction-neutral", () => {
    for (const relativePath of logicalUiStyles) {
      const css = read(relativePath);
      expect(css, relativePath).not.toMatch(
        /\b(?:margin|padding|border)-(?:left|right)(?:-\w+)?\s*:/,
      );
      expect(css, relativePath).not.toMatch(/text-align:\s*(?:left|right)\b/);
    }
  });

  it("mirrors directional icons and binary switch motion", () => {
    const base = read("../../../../src/styles/base.css");
    const settings = read("../../../../src/styles/settings.css");
    const access = read("../../../../src/features/cloud/sections/access/styles/create-access-dialog.css");

    expect(base).toContain('[dir="rtl"] .po-directional-icon');
    expect(base).toContain('[dir="rtl"] .desktop-cloud-directional-icon');
    expect(settings).toContain('[dir="rtl"] .desktop-settings-switch input:checked + span::before');
    expect(settings).toContain("transform: translateX(-14px);");
    expect(access).toContain('[dir="rtl"] .desktop-cloud-create-access-switch.checked span');
    expect(access).toContain("transform: translateX(-10px);");
  });

  it("pins technical content to explicit LTR islands", () => {
    expect(read("../../../../src/features/desktop-terminal/ui/TerminalSessionView.tsx"))
      .toContain('dir="ltr"');
    expect(read("../../../../src/features/source-control/diff/contributions/text-unified/TextUnifiedDiff.tsx"))
      .toContain('dir="ltr"');
    expect(read("../../../../src/features/source-control/sidebar/GitSidebarHistoryPanel.tsx"))
      .toContain('className="desktop-history-graph" aria-hidden="true" dir="ltr"');
    expect(read("../../../../src/features/cloud/history/CloudHistorySidebar.tsx"))
      .toMatch(/aria-hidden="true"\s+dir="ltr"/);
    expect(read("../../../../src/features/settings/main/RepositorySettingsViews.tsx"))
      .toContain('<code dir="ltr" title={copyUrl ?? ""}>');
    expect(read("../../../../src/features/settings/main/LocalProjectSettingsView.tsx"))
      .toContain('className="desktop-settings-row-value" dir="ltr" title={workspace.path}');
  });
});

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}
