import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLOUD_PUBLISH_ERROR_CODES } from "../../../../electron/main/cloud-initialization/contract.mjs";
import { formatCloudPublishFailure } from "../../../../src/features/cloud/cloudPresentation";
import type { CloudInitializationErrorCode } from "../../../../src/types/cloudInitialization";

// A refusal the user cannot read is a refusal they cannot act on. Every
// failure Main can name must reach the user in its own words; only a failure
// nobody could classify may read as the general message.

const GENERAL_MESSAGE = "cloud.message.project-publish-failed";
const repository = (relative: string) => fileURLToPath(new URL(`../../../../${relative}`, import.meta.url));
const codes = [...CLOUD_PUBLISH_ERROR_CODES] as CloudInitializationErrorCode[];
const messageFor = (code: CloudInitializationErrorCode) => formatCloudPublishFailure(
  { code, retryable: false },
  (messageId: string) => messageId,
);

function rendererErrorCodes(): string[] {
  const source = readFileSync(repository("src/types/cloudInitialization.ts"), "utf8");
  const union = /export type CloudInitializationErrorCode =([^;]+);/.exec(source)?.[1];
  if (!union) throw new Error("CloudInitializationErrorCode union not found");
  return [...union.matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]);
}

function localeCatalog(locale: string, namespace: string): Record<string, string> {
  return JSON.parse(readFileSync(repository(`locales/renderer/${locale}/${namespace}.json`), "utf8"));
}

const locales = (JSON.parse(readFileSync(repository("locales/manifest.json"), "utf8")) as {
  locales: Array<{ locale: string }>;
}).locales.map((entry) => entry.locale);

describe("Cloud first-push failure copy", () => {
  it("the Renderer names exactly the failures Main can return", () => {
    expect(rendererErrorCodes().sort()).toEqual([...CLOUD_PUBLISH_ERROR_CODES].sort());
  });

  it.each(codes.filter((code) => code !== "UNKNOWN"))("%s has its own message", (code) => {
    expect(messageFor(code)).not.toBe(GENERAL_MESSAGE);
  });

  it("an unclassified failure reads as the general message", () => {
    expect(messageFor("UNKNOWN")).toBe(GENERAL_MESSAGE);
  });

  it.each(locales)("every first-push failure message exists in %s", (locale) => {
    const missing = [...new Set(codes.map(messageFor))].filter((messageId) => {
      const [namespace, ...key] = messageId.split(".");
      return typeof localeCatalog(locale, namespace)[key.join(".")] !== "string";
    });
    expect(missing).toEqual([]);
  });
});
