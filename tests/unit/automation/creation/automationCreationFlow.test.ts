import { describe, expect, it } from "vitest";
import type { DesktopCloudAutomationProviderSpec } from "../../../../src/lib/cloudApi";
import {
  automationTriggerDraftFromConnection,
  buildAutomationConfig,
  buildDesktopCreateAutomationRequest,
  getAutomationTriggerValidationError,
  getAutomationTargetPathValidationError,
  getDefaultAutomationRunMode,
  getSupportedAutomationRunModes,
  normalizeAutomationTargetPath,
  validateFivePartCron,
} from "../../../../src/features/automation/automationRequest";
import {
  buildAutomationTemplates,
  getAutomationTemplatesForCategory,
} from "../../../../src/features/automation/automationTemplates";

describe("Automation creation flow", () => {
  it("only publishes templates backed by currently available Cloud providers", () => {
    const providers = [
      provider("gmail", "Gmail"),
      provider("google_docs", "Google Docs"),
      provider("google_sheets", "Google Sheets"),
      provider("url", "Web Page", "none"),
    ];

    const templates = buildAutomationTemplates(providers);
    expect(templates.map((template) => template.provider)).toEqual([
      "google_docs",
      "google_sheets",
      "gmail",
      "url",
    ]);
    expect(templates.some((template) => template.provider === "notion")).toBe(false);
    expect(getAutomationTemplatesForCategory(templates, "popular")).toHaveLength(4);
  });

  it("carries destination and schedule settings into the Cloud creation request", () => {
    const source = provider("google_docs", "Google Docs");
    const request = buildDesktopCreateAutomationRequest({
      projectId: "project-1",
      provider: source,
      configValues: { folder_id: "folder-123" },
      source: {
        resourceId: "doc-123",
        resourceName: "Product brief",
        resourceUrl: "https://docs.google.com/document/d/doc-123",
        resourceType: "document",
        metadata: { owner: "team@example.com" },
      },
      targetPath: "Research/Docs",
      trigger: {
        preset: "custom",
        time: "09:00",
        weekday: "1",
        customCron: "0 9 * * 1-5",
        timezone: "Asia/Singapore",
      },
    });

    expect(request).toMatchObject({
      project_id: "project-1",
      provider: "google_docs",
      target_folder_path: "Research/Docs",
      target_path: "Research/Docs",
      sync_mode: "scheduled",
      trigger: {
        type: "schedule",
        schedule: "0 9 * * 1-5",
        timezone: "Asia/Singapore",
      },
      config: {
        source: {
          resource_id: "doc-123",
          resource_name: "Product brief",
          resource_type: "document",
          resource_url: "https://docs.google.com/document/d/doc-123",
        },
        options: { folder_id: "folder-123" },
      },
    });
    expect(getSupportedAutomationRunModes(source)).toEqual(["manual", "scheduled"]);
    expect(getDefaultAutomationRunMode(source)).toBe("scheduled");
  });

  it("maps schedule presets and rejects invalid custom cron before transport", () => {
    const source = provider("google_docs", "Google Docs");
    const daily = automationTriggerDraftFromConnection(source, {
      type: "schedule",
      schedule: "30 8 * * *",
      timezone: "Asia/Singapore",
    });
    const weekly = automationTriggerDraftFromConnection(source, {
      type: "schedule",
      schedule: "15 10 * * 5",
      timezone: "UTC",
    });

    expect(daily).toMatchObject({ preset: "daily", time: "08:30", timezone: "Asia/Singapore" });
    expect(weekly).toMatchObject({ preset: "weekly", time: "10:15", weekday: "5" });
    expect(validateFivePartCron("0 9 * * 1-5")).toBeNull();
    expect(validateFivePartCron("70 25 * * *")).toEqual({ code: "cron-field", field: 1 });
    expect(getAutomationTriggerValidationError({
      ...daily,
      preset: "custom",
      customCron: "not cron",
    })).toEqual({ code: "cron-part-count" });
  });

  it("normalizes destination paths while preventing traversal above the project root", () => {
    expect(normalizeAutomationTargetPath("/Research//Drafts/../Docs/")).toBe("Research/Docs");
    expect(getAutomationTargetPathValidationError("Research/../Docs")).toBeNull();
    expect(getAutomationTargetPathValidationError("../../outside")).toEqual({ code: "target-outside-project" });
  });

  it("preserves unknown provider options while allowing editable fields to be cleared", () => {
    const source = provider("google_docs", "Google Docs");
    const config = buildAutomationConfig({
      provider: source,
      configValues: { folder_id: "" },
      source: null,
      baseConfig: { options: { folder_id: "old", provider_cursor_policy: "incremental" } },
    });
    expect(config.options).toEqual({ provider_cursor_policy: "incremental" });
  });
});

function provider(
  providerId: string,
  displayName: string,
  auth: DesktopCloudAutomationProviderSpec["auth"] = "oauth",
): DesktopCloudAutomationProviderSpec {
  return {
    provider: providerId,
    display_name: displayName,
    description: `${displayName} source`,
    auth,
    creation_mode: "direct",
    category: "datasource",
    icon: null,
    default_sync_mode: "scheduled",
    supported_sync_modes: ["manual", "scheduled"],
    config_fields: [{
      key: "folder_id",
      label: "Folder",
      type: "text",
      required: false,
      default: null,
      options: null,
      placeholder: null,
      hint: null,
    }],
  };
}
