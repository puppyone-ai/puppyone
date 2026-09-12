import { describe, expect, it } from "vitest";

import {
  cloudApiBaseUrlFromRemote,
  normalizeCloudApiBaseUrl,
  normalizeCloudApiPath,
  resolveCloudApiBaseUrl,
  sameCloudApiBaseUrl,
} from "../../../../shared/cloudEndpoint.js";

// First automated test for the desktop repo (ISSUE-023). Targets the pure,
// dependency-free cloud endpoint helpers to establish a runnable baseline.

describe("normalizeCloudApiBaseUrl", () => {
  it("rejects empty / non-string / non-http input", () => {
    expect(normalizeCloudApiBaseUrl("")).toBeNull();
    expect(normalizeCloudApiBaseUrl("   ")).toBeNull();
    expect(normalizeCloudApiBaseUrl(null)).toBeNull();
    expect(normalizeCloudApiBaseUrl("ftp://example.com")).toBeNull();
    expect(normalizeCloudApiBaseUrl("not a url")).toBeNull();
  });

  it("strips trailing slashes, hash and query", () => {
    expect(normalizeCloudApiBaseUrl("https://subdomain.puppyone.ai/api/v1/")).toBe(
      "https://subdomain.puppyone.ai/api/v1",
    );
    expect(normalizeCloudApiBaseUrl("https://subdomain.puppyone.ai/api/v1?x=1#frag")).toBe(
      "https://subdomain.puppyone.ai/api/v1",
    );
  });

  it("does not silently rewrite an insecure or incomplete production endpoint", () => {
    expect(normalizeCloudApiBaseUrl("http://api.puppyone.ai")).toBeNull();
    expect(normalizeCloudApiBaseUrl("https://api.puppyone.ai")).toBe("https://api.puppyone.ai");
  });

  it("SSRF guard: rejects non-PuppyOne hosts and internal/metadata targets", () => {
    expect(normalizeCloudApiBaseUrl("https://example.com/api/v1")).toBeNull();
    expect(normalizeCloudApiBaseUrl("http://169.254.169.254/latest/meta-data")).toBeNull();
    expect(normalizeCloudApiBaseUrl("http://10.0.0.5/internal")).toBeNull();
    // suffix-match must not be bypassable by a lookalike parent domain
    expect(normalizeCloudApiBaseUrl("https://evil.puppyone.ai.attacker.com/api/v1")).toBeNull();
  });

  it("SSRF guard: allows the PuppyOne host family and localhost (dev)", () => {
    expect(normalizeCloudApiBaseUrl("https://api.puppyone.ai/api/v1")).toBe("https://api.puppyone.ai/api/v1");
    expect(normalizeCloudApiBaseUrl("https://subdomain.puppyone.ai/api/v1")).toBe("https://subdomain.puppyone.ai/api/v1");
    expect(normalizeCloudApiBaseUrl("http://localhost:8000/api/v1")).toBe("http://localhost:8000/api/v1");
  });
});

describe("resolveCloudApiBaseUrl", () => {
  it("requires an explicit endpoint or explicit fallback", () => {
    expect(() => resolveCloudApiBaseUrl("")).toThrow("Cloud API base URL is not configured");
    expect(resolveCloudApiBaseUrl("garbage", "https://api.puppyone.ai/api/v1"))
      .toBe("https://api.puppyone.ai/api/v1");
  });
});

describe("cloudApiBaseUrlFromRemote", () => {
  it("derives the /api/v1 base from a git remote origin", () => {
    expect(cloudApiBaseUrlFromRemote("https://git.puppyone.ai/org/repo.git")).toBe(
      "https://git.puppyone.ai/api/v1",
    );
  });

  it("returns null for invalid remotes", () => {
    expect(cloudApiBaseUrlFromRemote("")).toBeNull();
    expect(cloudApiBaseUrlFromRemote("ssh://weird")).toBeNull();
  });
});

describe("normalizeCloudApiPath", () => {
  it("ensures a leading slash and defaults empty to '/'", () => {
    expect(normalizeCloudApiPath("nodes")).toBe("/nodes");
    expect(normalizeCloudApiPath("/nodes")).toBe("/nodes");
    expect(normalizeCloudApiPath("")).toBe("/");
  });
});

describe("sameCloudApiBaseUrl", () => {
  it("treats trailing-slash / scheme-normalized variants as equal", () => {
    expect(
      sameCloudApiBaseUrl("https://subdomain.puppyone.ai/api/v1", "https://subdomain.puppyone.ai/api/v1/"),
    ).toBe(true);
    expect(
      sameCloudApiBaseUrl("https://subdomain.puppyone.ai/api/v1", "https://api.puppyone.ai/api/v1"),
    ).toBe(false);
  });
});
