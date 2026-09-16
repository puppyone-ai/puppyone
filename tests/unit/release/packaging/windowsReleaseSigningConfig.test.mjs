import { describe, expect, it } from "vitest";
import {
  configureWindowsReleaseSigning,
} from "../../../../scripts/release-support/windows-release-signing-config.mjs";

describe("Windows release signing configuration", () => {
  it("pins SHA-256 and the full publisher subject used by updater verification", () => {
    const source = {
      productName: "PuppyOne",
      win: {
        target: ["nsis"],
        signtoolOptions: { rfc3161TimeStampServer: "https://timestamp.example.test" },
      },
    };

    expect(configureWindowsReleaseSigning(source, {
      publisherNames: ["CN=PuppyOne, O=PuppyOne Pte. Ltd., C=SG"],
    })).toEqual({
      productName: "PuppyOne",
      win: {
        target: ["nsis"],
        signtoolOptions: {
          publisherName: ["CN=PuppyOne, O=PuppyOne Pte. Ltd., C=SG"],
          rfc3161TimeStampServer: "https://timestamp.example.test",
          signingHashAlgorithms: ["sha256"],
        },
      },
    });
    expect(source.win.signtoolOptions).not.toHaveProperty("publisherName");
  });

  it("rejects a CN-only value that is not expressed as a certificate subject", () => {
    expect(() => configureWindowsReleaseSigning(
      { win: { target: ["nsis"] } },
      { publisherNames: ["PuppyOne"] },
    )).toThrow(/full certificate subject/);
  });

  it("rejects a configuration that is not an NSIS Windows target", () => {
    expect(() => configureWindowsReleaseSigning(
      { win: { target: ["portable"] } },
      { publisherNames: ["CN=PuppyOne"] },
    )).toThrow(/NSIS target/);
  });
});
