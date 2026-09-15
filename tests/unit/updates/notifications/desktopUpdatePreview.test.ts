import { describe, expect, it } from "vitest";
import {
  createDesktopUpdatePreviewState,
  readDesktopUpdatePreviewRequest,
} from "../../../../src/features/updates/updatePreview";

describe("desktop update visual preview", () => {
  it("cannot create a preview state outside development", () => {
    expect(createDesktopUpdatePreviewState({
      isDevelopment: false,
      requestedStatus: "downloaded",
    })).toBeNull();
  });

  it("creates an isolated downloaded fixture in development", () => {
    expect(createDesktopUpdatePreviewState({
      isDevelopment: true,
      requestedStatus: "downloaded",
      version: "1.2.3-preview.4",
    })).toMatchObject({
      status: "downloaded",
      channel: "dev",
      availableVersion: "1.2.3-preview.4",
      reason: "development-preview",
    });
  });

  it("prefers an explicit environment request over the URL helper", () => {
    expect(readDesktopUpdatePreviewRequest({
      environmentStatus: "downloaded",
      locationSearch: "?desktop-update-preview=ignored",
    })).toBe("downloaded");
    expect(readDesktopUpdatePreviewRequest({
      locationSearch: "?desktop-update-preview=downloaded",
    })).toBe("downloaded");
  });
});
