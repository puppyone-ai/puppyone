import fs from "node:fs";
import os from "node:os";
import { readUserCommandEnvironment } from "./command-environment.mjs";

/**
 * Platform-owned inputs used by executable discovery. Product definitions do
 * not read process globals directly, which keeps them deterministic in tests
 * and leaves room for platform-specific adapters without provider rewrites.
 */
export function createExecutableDiscoveryPort({
  nodePlatform = process.platform,
  env = process.env,
  homedir = os.homedir(),
  fsModule = fs,
  readEnvironment = readUserCommandEnvironment,
} = {}) {
  return Object.freeze({
    nodePlatform,
    env,
    homedir,
    fsModule,
    captureEnvironment: ({ signal } = {}) => readEnvironment({ env, homedir, platform: nodePlatform, signal }),
  });
}
