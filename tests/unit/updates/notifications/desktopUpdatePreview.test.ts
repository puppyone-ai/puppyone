import { describe, expect, it } from "vitest";
import {
  createDesktopUpdatePreviewState,
  readDesktopUpdatePreviewRequest,
} from "../../../../src/features/updates/updatePreview";

describe("desktop update visual preview", () => {
  it("cannot create a preview state outside development", () => {
    expect(createDesktopUpdatePreviewState({
      isDevelopment: false,
      requestedStatus: "available",
    })).toBeNull();
  });

  it("creates an isolated available fixture in development", () => {
    expect(createDesktopUpdatePreviewState({
      isDevelopment: true,
      requestedStatus: "available",
      version: "1.2.3-preview.4",
    })).toMatchObject({
      status: "available",
      channel: "dev",
      availableVersion: "1.2.3-preview.4",
      reason: "development-preview",
    });
  });

  it("prefers an explicit environment request over the URL helper", () => {
    expect(readDesktopUpdatePreviewRequest({
      environmentStatus: "available",
      locationSearch: "?desktop-update-preview=ignored",
    })).toBe("available");
    expect(readDesktopUpdatePreviewRequest({
      locationSearch: "?desktop-update-preview=available",
    })).toBe("available");
  });
});
