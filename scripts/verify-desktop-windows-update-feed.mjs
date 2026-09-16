#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { verifyDesktopStableUpdateFeeds } from "./release-support/desktop-update-feed-verifier.mjs";

const WINDOWS_STABLE_FEED_URL = "https://updates.puppyone.ai/desktop/stable/windows/x64/nsis/latest";
const WINDOWS_STABLE_LATEST_POINTER_URL = "https://downloads.puppyone.ai/desktop/stable/windows/x64/nsis/latest/latest.json";

export function parseWindowsUpdateFeedVerifierArguments(argv) {
  let expectedVersion = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--expected-version") throw new Error(`Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("--expected-version requires a value.");
    expectedVersion = value;
    index += 1;
  }
  return Object.freeze({ expectedVersion });
}

export async function runWindowsUpdateFeedVerifier(argv = process.argv.slice(2)) {
  const options = parseWindowsUpdateFeedVerifierArguments(argv);
  const result = await verifyDesktopStableUpdateFeeds({
    ...options,
    feedUrls: [WINDOWS_STABLE_FEED_URL],
    latestPointerUrl: WINDOWS_STABLE_LATEST_POINTER_URL,
    metadataName: "stable.yml",
    platform: "windows",
  });
  console.log(`Verified PuppyOne Desktop Windows Stable update contract for ${result.version}.`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runWindowsUpdateFeedVerifier();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
