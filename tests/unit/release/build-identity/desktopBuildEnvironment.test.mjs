import { describe, expect, it } from "vitest";
import { inspectDesktopBuildEnvironment } from "../../../../scripts/desktop-build-environment.mjs";

describe("desktop build environment policy", () => {
  it("accepts production HTTPS endpoints and loopback development endpoints", () => {
    expect(inspectDesktopBuildEnvironment({
      VITE_DESKTOP_CLOUD_API_URL: "https://api.puppyone.ai/api/v1",
      VITE_DESKTOP_CLOUD_WEB_URL: "https://app.puppyone.ai",
    })).toEqual([]);
    expect(inspectDesktopBuildEnvironment({
      VITE_DESKTOP_CLOUD_API_URL: "http://127.0.0.1:9090/api/v1",
      VITE_DESKTOP_CLOUD_WEB_URL: "http://localhost:3000",
    })).toEqual([]);
  });

  it("fails before bundling when required endpoints are absent", () => {
    expect(inspectDesktopBuildEnvironment({})).toEqual([
      "VITE_DESKTOP_CLOUD_API_URL is required",
      "VITE_DESKTOP_CLOUD_WEB_URL is required",
    ]);
  });

  it("rejects insecure remote, credential-bearing, and malformed API endpoints", () => {
    const errors = inspectDesktopBuildEnvironment({
      VITE_DESKTOP_CLOUD_API_URL: "http://user:secret@example.com/v2?token=secret",
      VITE_DESKTOP_CLOUD_WEB_URL: "not-a-url",
    });
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/must not contain credentials/i),
      expect.stringMatching(/query parameters or fragments/i),
      expect.stringMatching(/must use HTTPS/i),
      expect.stringMatching(/\/api\/v1/i),
      expect.stringMatching(/absolute http\(s\) URL/i),
    ]));
  });
});
