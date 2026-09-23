#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectRemoteReleaseEntries,
  createAuthorizationHeaders,
  REMOTE_VERIFICATION_DEFAULTS,
  verifyRemoteReleaseEntries,
} from "./release-support/desktop-release-remote-verifier.mjs";

export function parseRemoteVerificationArguments(argv) {
  const targets = [];
  const options = {};
  const collection = {};
  const seen = new Set();
  let bundle;
  let urlPrefix;
  const optionNames = new Map(Object.keys(REMOTE_VERIFICATION_DEFAULTS).map(name => [
    `--${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, name,
  ]));
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    const value = argv[++index];
    if (!key?.startsWith("--") || value == null || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    if (key === "--target") {
      const prefix = argv[++index];
      if (prefix == null || prefix.startsWith("--")) throw new Error("--target requires <bundle> <HTTPS URL prefix>");
      targets.push({ bundle: value, urlPrefix: prefix });
      continue;
    }
    if (seen.has(key)) throw new Error(`Duplicate option ${key}`);
    seen.add(key);
    if (key === "--bundle") bundle = value;
    else if (key === "--url-prefix") urlPrefix = value;
    else if (["--include-aliases", "--include-metadata"].includes(key)) {
      if (!["true", "false"].includes(value)) throw new Error(`${key} must be true or false`);
      collection[key === "--include-aliases" ? "includeAliases" : "includeMetadata"] = value === "true";
    } else if (optionNames.has(key)) {
      if (!/^[1-9]\d*$/.test(value)) throw new Error(`${key} must be a positive integer`);
      options[optionNames.get(key)] = Number(value);
    } else throw new Error(`Unknown option ${key}`);
  }
  if (bundle || urlPrefix) {
    if (!bundle || !urlPrefix || targets.length) throw new Error("Use --bundle with --url-prefix, or repeated --target pairs");
    targets.push({ bundle, urlPrefix });
  }
  if (!targets.length) throw new Error("Provide --bundle/--url-prefix or --target <bundle> <HTTPS URL prefix>");
  return { targets, options, collection };
}

export async function runRemoteReleaseVerification(argv = process.argv.slice(2)) {
  const { targets, options, collection } = parseRemoteVerificationArguments(argv);
  const entries = await collectRemoteReleaseEntries(targets, collection);
  return verifyRemoteReleaseEntries(entries, { ...options, headers: createAuthorizationHeaders(process.env) });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runRemoteReleaseVerification();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
