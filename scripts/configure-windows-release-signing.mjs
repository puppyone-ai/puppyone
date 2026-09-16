#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  configureWindowsReleaseSigning,
} from "./release-support/windows-release-signing-config.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const options = parseArguments(process.argv.slice(2));
  const configPath = resolveRepositoryFile(options.config ?? "generated/electron-builder.json");
  const source = JSON.parse(await fs.readFile(configPath, "utf8"));
  const configured = configureWindowsReleaseSigning(source, {
    publisherNames: options.publisherNames,
  });
  await writeJsonAtomic(configPath, configured);
  console.log(`Configured Windows release signing for ${options.publisherNames.length} publisher subject(s).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArguments(values) {
  const options = { publisherNames: [] };
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const value = values[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    index += 1;
    if (argument === "--publisher-name") options.publisherNames.push(value);
    else if (argument === "--config") options.config = value;
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (options.publisherNames.length === 0) {
    throw new Error("At least one --publisher-name is required.");
  }
  return options;
}

function resolveRepositoryFile(value) {
  const resolved = path.resolve(repositoryRoot, value);
  const relative = path.relative(repositoryRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Windows signing configuration must stay inside the repository: ${value}`);
  }
  return resolved;
}

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}
