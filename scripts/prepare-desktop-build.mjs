#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_BUILDER_CONFIG_PATH,
  DEFAULT_BUILD_INFO_PATH,
  prepareDesktopBuild,
} from "./release-support/desktop-build-preparation.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const options = parseArguments(process.argv.slice(2));
  const prepared = await prepareDesktopBuild({
    repositoryRoot,
    channel: options.channel ?? process.env.PUPPYONE_BUILD_CHANNEL ?? "dev",
    buildNumber: options.buildNumber ?? process.env.PUPPYONE_BUILD_NUMBER ?? process.env.GITHUB_RUN_NUMBER,
    commitSha: options.commitSha ?? process.env.GITHUB_SHA,
    builtAt: options.builtAt ?? process.env.PUPPYONE_BUILD_TIMESTAMP,
    sourceDirty: options.sourceDirty,
    expectedTag: options.expectedTag,
    target: options.target,
    displayName: options.displayName,
    buildInfoPath: options.buildInfoPath ?? DEFAULT_BUILD_INFO_PATH,
    builderConfigPath: options.builderConfigPath ?? DEFAULT_BUILDER_CONFIG_PATH,
  });

  if (options.githubOutputPath) {
    const outputs = {
      app_id: prepared.builderConfig.appId,
      arch: prepared.target.arch,
      artifact_name: prepared.artifactName,
      base_version: prepared.buildInfo.baseVersion,
      build_id: prepared.buildInfo.buildId,
      build_info_path: prepared.buildInfoPath,
      builder_config_path: prepared.builderConfigPath,
      channel: prepared.buildInfo.channel,
      published_at: prepared.buildInfo.builtAt,
      release_name: prepared.releaseName,
      r2_prefix: prepared.r2Prefix ?? "",
      tag: prepared.tag ?? "",
      target_arch: prepared.target.arch,
      target_id: prepared.target.id,
      target_platform: prepared.target.platform,
      target_runtime_key: prepared.target.upstreamRuntimeKey,
      target_update_track: prepared.target.updateTrack,
      version: prepared.buildInfo.version,
    };
    await fs.appendFile(
      path.resolve(repositoryRoot, options.githubOutputPath),
      `${Object.entries(outputs).map(([key, value]) => `${key}=${value}`).join("\n")}\n`,
      "utf8",
    );
  }

  console.log(JSON.stringify({
    buildInfo: prepared.buildInfo,
    buildInfoPath: prepared.buildInfoPath,
    builderConfigPath: prepared.builderConfigPath,
    target: prepared.target,
    tag: prepared.tag,
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArguments(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const key = argument.slice(2);
    if (key === "dirty" || key === "clean") {
      options.sourceDirty = key === "dirty";
      continue;
    }
    const value = values[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    index += 1;
    if (key === "channel") options.channel = value;
    else if (key === "build-number") options.buildNumber = value;
    else if (key === "commit") options.commitSha = value;
    else if (key === "built-at") options.builtAt = value;
    else if (key === "expected-tag") options.expectedTag = value;
    else if (key === "target") options.target = value;
    else if (key === "display-name") options.displayName = value;
    else if (key === "build-info") options.buildInfoPath = value;
    else if (key === "builder-config") options.builderConfigPath = value;
    else if (key === "github-output") options.githubOutputPath = value;
    else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}
