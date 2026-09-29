import { describe, expect, it } from "vitest";
import { parseRemoteVerificationArguments } from "../../../../scripts/verify-desktop-release-remote.mjs";
import { normalizeReleaseUrlPrefix, verifyRemoteReleaseEntries } from "../../../../scripts/release-support/desktop-release-remote-verifier.mjs";

describe("release verification command contract", () => {
  it("preserves the existing single-bundle Internal and Stable callers", () => {
    expect(parseRemoteVerificationArguments([
      "--bundle", "bundle path", "--url-prefix", "https://downloads.example/release",
      "--include-aliases", "true", "--include-metadata", "false",
    ])).toEqual({ targets: [{ bundle: "bundle path", urlPrefix: "https://downloads.example/release" }], options: {}, collection: { includeAliases: true, includeMetadata: false } });
  });
  it("collects multiple platforms and origins into one configured pool", () => {
    expect(parseRemoteVerificationArguments([
      "--target", "mac", "https://downloads.example/mac", "--target", "win", "https://updates.example/win",
      "--concurrency", "3", "--file-timeout-ms", "200000",
    ])).toMatchObject({ targets: [{ bundle: "mac" }, { bundle: "win" }], options: { concurrency: 3, fileTimeoutMs: 200000 } });
  });
  it.each([
    [], ["--target", "mac"], ["--bundle", "mac"],
    ["--target", "mac", "https://host/mac", "--bundle", "win", "--url-prefix", "https://host/win"],
    ["--target", "mac", "https://host/mac", "--concurrency", "0"],
    ["--target", "mac", "https://host/mac", "--concurrency", "1.5"],
    ["--target", "mac", "https://host/mac", "--include-aliases", "yes"],
    ["--target", "mac", "https://host/mac", "--unknown", "1"],
    ["--bundle", "a", "--bundle", "b", "--url-prefix", "https://host/mac"],
  ].map(args => [args]))("rejects incomplete or ambiguous arguments: %j", args => {
    expect(() => parseRemoteVerificationArguments(args)).toThrow();
  });
  it.each(["http://host/path", "https://user:secret@host/path", "https://host/path?token=secret", "https://host/path#hash"])("rejects unsafe target prefix %s", value => {
    expect(() => normalizeReleaseUrlPrefix(value)).toThrow();
  });
  it.each([{ concurrency: 9 }, { attempts: 6 }, { idleTimeoutMs: 0 }, { fileTimeoutMs: NaN }, { unsupported: 1 }])("rejects unsafe pool options before HTTP: %j", async options => {
    let called = false;
    await expect(verifyRemoteReleaseEntries([], { ...options, fetchImpl: () => { called = true; } })).rejects.toThrow();
    expect(called).toBe(false);
  });
});
