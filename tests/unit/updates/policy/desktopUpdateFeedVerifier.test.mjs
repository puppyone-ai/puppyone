import { describe, expect, it, vi } from "vitest";
import {
  parseDesktopUpdaterMetadata,
  verifyDesktopStableUpdateFeeds,
} from "../../../../scripts/release-support/desktop-update-feed-verifier.mjs";
import {
  parseDesktopUpdateFeedVerifierArguments,
} from "../../../../scripts/verify-desktop-stable-update-feed.mjs";

const VERSION = "1.2.3";
const ZIP_SHA512 = Buffer.alloc(64, 1).toString("base64");
const DMG_SHA512 = Buffer.alloc(64, 2).toString("base64");
const METADATA = [
  `version: ${VERSION}`,
  "files:",
  "  - url: PuppyOne-1.2.3-arm64.zip",
  `    sha512: ${ZIP_SHA512}`,
  "    size: 9",
  "  - url: PuppyOne-1.2.3-arm64.dmg",
  `    sha512: ${DMG_SHA512}`,
  "    size: 11",
  "path: PuppyOne-1.2.3-arm64.zip",
  `sha512: ${ZIP_SHA512}`,
  "releaseDate: '2026-07-30T08:00:00.000Z'",
  "",
].join("\n");

describe("Desktop Stable update feed verifier", () => {
  it("parses the controlled electron-builder metadata contract", () => {
    expect(parseDesktopUpdaterMetadata(METADATA)).toEqual({
      version: VERSION,
      files: [
        {
          url: "PuppyOne-1.2.3-arm64.zip",
          sha512: ZIP_SHA512,
          size: 9,
        },
        {
          url: "PuppyOne-1.2.3-arm64.dmg",
          sha512: DMG_SHA512,
          size: 11,
        },
      ],
      path: "PuppyOne-1.2.3-arm64.zip",
      sha512: ZIP_SHA512,
      releaseDate: "2026-07-30T08:00:00.000Z",
    });
  });

  it("accepts the NSIS executable contract for Windows", () => {
    const metadata = parseDesktopUpdaterMetadata([
      "version: 0.3.20",
      "files:",
      "  - url: puppyone-0.3.20-x64-setup.exe",
      `    sha512: ${ZIP_SHA512}`,
      "    size: 4096",
      "path: puppyone-0.3.20-x64-setup.exe",
      `sha512: ${ZIP_SHA512}`,
      "releaseDate: '2026-09-16T12:00:00.000Z'",
    ].join("\n"), { platform: "windows" });

    expect(metadata.files[0].url).toBe("puppyone-0.3.20-x64-setup.exe");
  });

  it("rejects malformed metadata instead of trusting YAML-like fields", () => {
    expect(() => parseDesktopUpdaterMetadata(
      METADATA
        .replace(ZIP_SHA512, "not-a-sha512")
        .replace("releaseDate: '2026-07-30T08:00:00.000Z'", ""),
    )).toThrow(/base64 SHA-512 digest[\s\S]*valid timestamp/);
  });

  it("verifies every registered feed, version alignment, and byte ranges", async () => {
    const feedUrls = [
      "https://updates-one.example/desktop/stable/mac/latest",
      "https://updates-two.example/desktop/stable/mac/latest",
    ];
    const fetchImpl = createFeedFetch();

    const result = await verifyDesktopStableUpdateFeeds({
      attempts: 1,
      expectedVersion: VERSION,
      feedUrls,
      fetchImpl,
      latestPointerUrl: "https://downloads.example/desktop/stable/mac/latest/latest.json",
      retryDelayMs: 0,
      timeoutMs: 1_000,
    });

    expect(result.version).toBe(VERSION);
    expect(result.reports).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(7);
    expect(fetchImpl.mock.calls.filter(([, init]) => init?.headers?.Range === "bytes=0-0"))
      .toHaveLength(4);
  });

  it("rejects a latest pointer that does not match the release being published", async () => {
    await expect(verifyDesktopStableUpdateFeeds({
      attempts: 1,
      expectedVersion: "1.2.4",
      feedUrls: ["https://updates.example/desktop/stable/mac/latest"],
      fetchImpl: createFeedFetch(),
      latestPointerUrl: "https://downloads.example/desktop/stable/mac/latest/latest.json",
      retryDelayMs: 0,
      timeoutMs: 1_000,
    })).rejects.toThrow("reports 1.2.3, expected 1.2.4");
  });

  it("rejects origins that do not support exact byte ranges", async () => {
    await expect(verifyDesktopStableUpdateFeeds({
      attempts: 1,
      feedUrls: ["https://updates.example/desktop/stable/mac/latest"],
      fetchImpl: createFeedFetch({ rangeStatus: 200 }),
      latestPointerUrl: "https://downloads.example/desktop/stable/mac/latest/latest.json",
      retryDelayMs: 0,
      timeoutMs: 1_000,
    })).rejects.toThrow("HTTP 200");
  });

  it("rejects payload size drift between metadata and storage", async () => {
    await expect(verifyDesktopStableUpdateFeeds({
      attempts: 1,
      feedUrls: ["https://updates.example/desktop/stable/mac/latest"],
      fetchImpl: createFeedFetch({ sizeOffset: 1 }),
      latestPointerUrl: "https://downloads.example/desktop/stable/mac/latest/latest.json",
      retryDelayMs: 0,
      timeoutMs: 1_000,
    })).rejects.toThrow("reports 10 bytes, expected 9");
  });

  it("accepts only the explicit expected-version CLI option", () => {
    expect(parseDesktopUpdateFeedVerifierArguments([
      "--expected-version",
      VERSION,
    ])).toEqual({
      expectedVersion: VERSION,
    });
    expect(() => parseDesktopUpdateFeedVerifierArguments(["--feed", "unexpected"]))
      .toThrow("Unknown argument");
    expect(() => parseDesktopUpdateFeedVerifierArguments(["--expected-version"]))
      .toThrow("requires a value");
  });

  it("rejects duplicate feed contracts and invalid retry bounds", async () => {
    await expect(verifyDesktopStableUpdateFeeds({
      feedUrls: [
        "https://updates.example/desktop/stable/mac/latest",
        "https://updates.example/desktop/stable/mac/latest",
      ],
      fetchImpl: createFeedFetch(),
    })).rejects.toThrow("must be unique");
    await expect(verifyDesktopStableUpdateFeeds({
      attempts: 0,
      feedUrls: ["https://updates.example/desktop/stable/mac/latest"],
      fetchImpl: createFeedFetch(),
    })).rejects.toThrow("attempts must be an integer");
  });
});

function createFeedFetch({ rangeStatus = 206, sizeOffset = 0 } = {}) {
  return vi.fn(async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/latest.json")) {
      return new Response(JSON.stringify({
        channel: "stable",
        tag: `v${VERSION}`,
        version: VERSION,
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }
    if (url.endsWith("/stable-mac.yml")) {
      return new Response(METADATA, {
        status: 200,
        headers: {
          "Content-Type": "text/yaml",
        },
      });
    }
    if (init.headers?.Range === "bytes=0-0") {
      const expectedSize = url.endsWith(".zip") ? 9 : 11;
      return new Response(new Uint8Array([1]), {
        status: rangeStatus,
        headers: {
          "Content-Length": rangeStatus === 206 ? "1" : String(expectedSize),
          "Content-Range": `bytes 0-0/${expectedSize + sizeOffset}`,
        },
      });
    }
    return new Response("not found", { status: 404 });
  });
}
