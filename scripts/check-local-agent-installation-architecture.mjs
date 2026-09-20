#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const retiredFiles = [
  "electron/main/local-executable-resolver.mjs",
  "electron/main/terminal-agent/terminal-agent-catalog.mjs",
  "electron/main/terminal-agent/terminal-agent-candidate-resolver.mjs",
  "electron/main/terminal-agent/terminal-agent-identity.mjs",
  "electron/main/terminal-agent/terminal-agent-locator.mjs",
  "src/features/desktop-terminal/controller/useTerminalAgentLocator.ts",
  "src/features/desktop-terminal/infrastructure/electron/terminalAgentLocatorClient.ts",
  "src/features/desktop-terminal/model/terminalAgentAvailability.ts",
];

for (const file of retiredFiles) {
  if (fs.existsSync(resolve(file))) errors.push(`${file} must remain retired after the installation-discovery migration`);
}

for (const file of [
  "electron/main/local-agent-installation/installation-registry.mjs",
  "electron/main/local-agent-installation/executable-resolver.mjs",
  "electron/main/local-agent-installation/installation-service.mjs",
  "electron/main/platform/common/executable-discovery-port.mjs",
  "shared/local-agent-installation/schema.mjs",
  "shared/local-agent-installation/types.ts",
  "src/features/local-agents/application/LocalAgentInstallationStore.ts",
  "electron/main/local-agent-installation/setup/setup-registry.mjs",
  "electron/main/local-agent-installation/setup/setup-advisor.mjs",
  "electron/main/local-agent-installation/setup/setup-service.mjs",
  "shared/local-agent-installation/setup-types.ts",
]) {
  if (!fs.existsSync(resolve(file))) errors.push(`${file} is required by the Local Agent installation boundary`);
}

const main = read("electron/main.mjs");
requireText(main, "createLocalAgentInstallationService", "Electron main must compose one application-scoped installation service");
requireText(main, "desktopPlatformHost.executableDiscovery", "Installation discovery must consume the platform executable-discovery port");
const preload = read("electron/preload.cjs");
requireText(preload, "discoverLocalAgentInstallations", "Preload must expose the installation discovery contract");
requireText(preload, "onLocalAgentInstallationsChanged", "Preload must expose cross-window snapshot convergence");
requireText(main, "createLocalAgentSetupService", "Main must own the setup advisor and action broker");
requireText(main, "desktopPlatformHost.companionApps", "Companion evidence must use the read-only platform port");
requireText(preload, "localAgentSetup:", "Preload must expose ID-only setup actions");
for (const file of walk(resolve("electron/main/local-agent-installation/setup"))) {
  if (/node:child_process|execFile\(|spawn\(|src\/features/u.test(fs.readFileSync(file, "utf8"))) {
    errors.push(`${relative(file)} must not execute installers or depend on Renderer`);
  }
}
requireText(read("electron/main/local-agent-installation/setup/setup-service.mjs"), "openExternal(route.guideUrl)", "Setup actions must resolve official guides from the trusted registry");

requireText(main, "composeLocalAgentActivation", "Main must compose application-owned activation tasks");
requireText(preload, "localAgentActivation:", "Activation needs a separate ID-only control channel");
for (const file of walk(resolve("electron/main/local-agent-activation"))) {
  if (/agent\/runtimes|src\/features|electron["']/u.test(fs.readFileSync(file, "utf8"))) {
    errors.push(`${relative(file)} must remain installation-only and receive platform dependencies from composition`);
  }
}
if (/agent\/runtimes|agent\/connections/u.test(read("electron/main/compose-local-agent-activation.mjs"))) {
  errors.push("Activation composition must not depend on runtime authentication or protocol readiness");
}
for (const file of walk(resolve("src/features/local-agents"))) {
  if (/node:child_process|electron\/main|child_process|shell\.openExternal/u.test(fs.readFileSync(file, "utf8"))) {
    errors.push(`${relative(file)} must not execute setup or cross the privileged activation boundary`);
  }
}

const terminalLaunch = read("electron/main/terminal-agent/terminal-agent-launch-resolver.mjs");
requireText(terminalLaunch, "createLocalAgentExecutableResolver", "Terminal launch must re-resolve through the shared installation engine");
const executableDiscovery = read("electron/main/agent/transports/executable-discovery.mjs");
requireText(executableDiscovery, "createLocalAgentExecutableResolver", "Agent Runtime discovery must reuse executable resolution");
for (const [file, installationId] of [
  ["electron/main/agent/runtimes/codex/codex-discovery.mjs", "codex"],
  ["electron/main/agent/runtimes/claude/claude-discovery.mjs", "claude"],
  ["electron/main/agent/runtimes/opencode-native/opencode-native-discovery.mjs", "opencode"],
  ["electron/main/agent/runtimes/pi/pi-discovery.mjs", "pi"],
  ["electron/main/agent/runtimes/hermes/hermes-discovery.mjs", "hermes"],
]) {
  requireText(read(file), `installationId: "${installationId}"`, `${file} must select its shared installation definition`);
}
const workBuddyDiscovery = read("electron/main/agent/runtimes/workbuddy/workbuddy-discovery.mjs");
requireText(workBuddyDiscovery, "installationId: channel.installationId", "WorkBuddy Runtime discovery must select its channel-specific shared installation definition");
const workBuddyChannels = read("electron/main/agent/runtimes/workbuddy/workbuddy-channels.mjs");
requireText(workBuddyChannels, 'installationId: "workbuddy-china"', "WorkBuddy China must own a stable installation identity");
requireText(workBuddyChannels, 'installationId: "workbuddy-international"', "WorkBuddy International must own a stable installation identity");
requireText(read("electron/main/agent/runtimes/cursor/cursor-discovery.mjs"), 'resolver.resolve("cursor", { context })', "Cursor Runtime must use its shared environment and installation definition");

const resolverSource = read("electron/main/local-agent-installation/executable-resolver.mjs");
requireText(resolverSource, "discoveryPort.captureEnvironment", "Each scan must obtain its command environment from Platform");
if (/boundedNvm|NVM_BIN|PNPM_HOME|\.npm-global|\.volta|\.asdf/u.test(resolverSource)) {
  errors.push("The shared resolver must follow PATH instead of enumerating package-manager layouts");
}
if (/readLoginShellEnvironment|loadLoginShellEnvironment|deterministicAgentPath/u.test(executableDiscovery)) {
  errors.push("Runtime transports must not own a second shell environment or PATH policy");
}
for (const file of walk(resolve("electron/main/platform"))) {
  if (/from ["'][^"']*agent\//u.test(fs.readFileSync(file, "utf8"))) {
    errors.push(`${relative(file)} must not depend on Agent implementations`);
  }
}

const managedPuppyOne = read("electron/main/agent/runtimes/puppyone-agent/puppyone-agent-discovery.mjs");
if (managedPuppyOne.includes("installationId:") || managedPuppyOne.includes("discoverExecutable(")) {
  errors.push("Managed PuppyOne Agent must not fall back to any user-installed Agent definition");
}

for (const file of walk(resolve("electron/main/local-agent-installation/definitions"))) {
  const source = fs.readFileSync(file, "utf8");
  if (/agent\/runtimes|agent\/connections|src\/features/u.test(source)) {
    errors.push(`${relative(file)} must remain declarative and independent of Runtime/UI modules`);
  }
}

for (const file of walk(resolve("src"))) {
  const source = fs.readFileSync(file, "utf8");
  if (/locateTerminalAgents|onTerminalAgentLocationProgress|useTerminalAgentLocator/u.test(source)) {
    errors.push(`${relative(file)} references the retired Terminal-only discovery boundary`);
  }
}

if (errors.length > 0) {
  console.error("Local Agent installation architecture check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log("Local Agent installation ownership, refresh, and consumer boundaries verified.");

function resolve(file) {
  return path.join(repositoryRoot, file);
}

function read(file) {
  return fs.readFileSync(resolve(file), "utf8");
}

function requireText(source, snippet, message) {
  if (!source.includes(snippet)) errors.push(message);
}

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(file));
    else if (/\.(?:mjs|cjs|ts|tsx)$/u.test(entry.name)) files.push(file);
  }
  return files;
}

function relative(file) {
  return path.relative(repositoryRoot, file).replaceAll(path.sep, "/");
}
