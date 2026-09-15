#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const providers = ["codex", "claude", "cursor", "opencode", "pi", "hermes"];

checkTree("shared/agent-activity-contract", [
  /(?:^|["'])electron(?:["'/]|$)/u,
  /(?:^|["'])react(?:["'/]|$)/u,
  /tool_input|hook_event_name|PreToolUse/u,
], "shared contract contains native/provider or UI code");

checkTree("electron/main/agent-activity", [
  /terminal-agent\/activity\/adapters/u,
  /(?:codex|claude|cursor|opencode|hermes)ActivityAdapter/u,
], "neutral broker imports a concrete Terminal provider");

checkTree("src/features/desktop-agent-presence", [
  /desktop-terminal/u,
  /terminal-agent\/activity/u,
  /tool_input|hook_event_name|PreToolUse/u,
], "Renderer presence imports Terminal/provider internals");

for (const provider of providers) {
  requirePath(`electron/main/terminal-agent/activity/adapters/${provider}/descriptor.mjs`);
}

const registry = read("electron/main/terminal-agent/activity/terminal-agent-activity-adapter-registry.mjs");
for (const provider of providers) {
  if (!registry.includes(`./adapters/${provider}/descriptor.mjs`)) {
    errors.push(`adapter registry is missing ${provider}`);
  }
}

for (const filePath of sourceFiles(path.join(root, "src", "features", "editor-workbench"))) {
  const source = readFileSync(filePath, "utf8");
  if (/terminal-agent\/activity|hook_event_name|tool_input/u.test(source)) {
    errors.push(`${relative(filePath)} bypasses the public presence feature`);
  }
}

requirePath("src/features/local-agents/ui/LocalAgentsSettingsView.tsx");
requirePath("src/features/local-agents/ui/LocalAgentHooksSettingsView.tsx");
requirePath("electron/main/terminal-agent/activity/registration/cursor-cli-hook-config.mjs");
requirePath("electron/main/terminal-agent/activity/bridge/shell-file-intent.mjs");
requirePath("tests/fixtures/agent/activity/codex-0.147.0/pre-tool-use-bash-read.json");
requirePath("tests/fixtures/agent/activity/codex-0.147.0/pre-tool-use-apply-patch-write.json");
requirePath("tests/fixtures/agent/activity/README.md");
const activityFixtureRoot = path.join(root, "tests", "fixtures", "agent", "activity");
for (const filePath of files(activityFixtureRoot)) {
  if (path.extname(filePath) !== ".json") continue;
  const source = readFileSync(filePath, "utf8");
  if (/(?:\/Users\/|\/home\/|[A-Za-z]:\\\\Users\\\\)/u.test(source)) {
    errors.push(`${relative(filePath)} contains a developer home path; Agent fixtures must be synthetic`);
  }
  let fixture;
  try {
    fixture = JSON.parse(source);
  } catch {
    errors.push(`${relative(filePath)} is not valid JSON`);
    continue;
  }
  for (const key of ["cwd", "workspace_root", "workspaceRoot", "project_root", "projectRoot"]) {
    if (typeof fixture[key] === "string" && !fixture[key].startsWith("/workspace")) {
      errors.push(`${relative(filePath)} must use a synthetic /workspace value for ${key}`);
    }
  }
  if (fixture.transcript_path !== null && fixture.transcript_path !== undefined) {
    errors.push(`${relative(filePath)} must not retain a transcript path`);
  }
  for (const key of [
    "session_id",
    "turn_id",
    "tool_use_id",
    "conversation_id",
    "generation_id",
  ]) {
    if (typeof fixture[key] === "string" && !/(?:fixture|test)/u.test(fixture[key])) {
      errors.push(`${relative(filePath)} must use a synthetic ${key}`);
    }
  }
}
const generalSettings = read("src/features/settings/main/GeneralSettingsView.tsx");
if (/AgentActivity|agentFileActivity|localAgents/u.test(generalSettings)) {
  errors.push("General Settings must not own Agent activity enrollment");
}

const localAgentsSettings = read("src/features/local-agents/ui/LocalAgentsSettingsView.tsx");
if (!localAgentsSettings.includes("useLocalAgentInstallations")
    || !localAgentsSettings.includes("DESKTOP_TERMINAL_LAUNCHERS")
    || !localAgentsSettings.includes("desktop-settings-switch")
    || !localAgentsSettings.includes("setTerminalAgentVisible")) {
  errors.push("Local Agents must use Terminal CLI discovery and compact launcher visibility rows");
}
if (/getAgentActivityEnrollment|setAgentActivityEnrollment/u.test(localAgentsSettings)) {
  errors.push("The Local Agents page may compose Hooks but must not directly own native enrollment");
}

const passiveTerminalAgentDiscoveryFiles = [
  "electron/main/local-agent-installation/installation-service.mjs",
  "electron/main/local-agent-installation/executable-resolver.mjs",
  "src/features/local-agents/application/LocalAgentInstallationStore.ts",
  "src/features/local-agents/controller/useLocalAgentInstallations.ts",
];
const hookEnrollmentPattern = /(?:agent-activity:enrollment|terminal-agent\/activity|hook-registration|reconcileNativeActivityHooks|getAgentActivityEnrollment|setAgentActivityEnrollment)/u;
for (const filePath of passiveTerminalAgentDiscoveryFiles) {
  if (hookEnrollmentPattern.test(read(filePath))) {
    errors.push(`${filePath} couples passive local Agent discovery to Hook enrollment`);
  }
}

const settingsModel = read("src/features/settings/sidebar/settingsSidebarModel.ts");
const desktopAppGroup = settingsModel.slice(
  settingsModel.indexOf('id: "desktop-app"'),
  settingsModel.indexOf('id: "local-project"'),
);
if (!desktopAppGroup.includes('id: "local-agents"')) {
  errors.push("Local Agents must remain a first-class Desktop App settings page");
}
const localAgentHooksIndex = desktopAppGroup.indexOf('id: "local-agent-hooks"');
if (localAgentHooksIndex >= 0) {
  errors.push("Local Agent Hooks must be a subsection of Local Agents, not a separate settings page");
}

const settingsView = read("src/features/settings/SettingsView.tsx");
const localAgentsPage = read("src/features/local-agents/ui/LocalAgentsSettingsView.tsx");
if (!localAgentsPage.includes("<LocalAgentHooksSettingsSection")
    || settingsView.includes('activeSection === "local-agent-hooks"')
    || settingsView.includes("<AgentFileActivityAppearanceSetting")) {
  errors.push("Native Hook enrollment must live under the Local Agents settings page");
}

const localAgentHooksSettings = read("src/features/local-agents/ui/LocalAgentHooksSettingsView.tsx");
const enrollmentSetIndex = localAgentHooksSettings.indexOf("await setEnrollment");
const activityPreferenceIndex = localAgentHooksSettings.indexOf(
  "onActivityIndicatorsEnabledChange",
  enrollmentSetIndex,
);
if (!localAgentHooksSettings.includes("getAgentActivityEnrollment")
    || !localAgentHooksSettings.includes("setAgentActivityEnrollment")
    || !localAgentHooksSettings.includes("selectableProviders.map")
    || !localAgentHooksSettings.includes("provider.configurable")
    || !localAgentHooksSettings.includes("detected.has(provider.providerId)")
    || !localAgentHooksSettings.includes('provider.enrollment === "enabled"')
    || !localAgentHooksSettings.includes('provider.enrollment === "needs-repair"')) {
  errors.push("Local Agent Hooks must expose opt-in controls only for configurable detected or already-enrolled providers");
}
if (enrollmentSetIndex < 0 || activityPreferenceIndex < enrollmentSetIndex) {
  errors.push("Agent activity visibility must update only after native Hook enrollment succeeds");
}

const hookRegistrationService = read("electron/main/terminal-agent/activity/registration/hook-registration-service.mjs");
const cursorHookConfig = read("electron/main/terminal-agent/activity/registration/cursor-cli-hook-config.mjs");
const bridgeInstaller = read("electron/main/terminal-agent/activity/registration/bridge-installer.mjs");
const payloadProjector = read("electron/main/terminal-agent/activity/bridge/payload-projector.mjs");
if (!hookRegistrationService.includes('{ providerId: "cursor", displayName: "Cursor Agent CLI", configurable: true }')
    || !hookRegistrationService.includes('path.join(homedir, ".cursor", "hooks.json")')) {
  errors.push("Cursor Agent CLI must remain an automatically configurable user-level Hook provider");
}
for (const eventName of ["preToolUse", "postToolUse", "postToolUseFailure", "sessionEnd"]) {
  if (!cursorHookConfig.includes(`name: "${eventName}"`)) {
    errors.push(`Cursor Agent CLI registration is missing ${eventName}`);
  }
}
if (!cursorHookConfig.includes("writeOwnedJsonFileIfUnchanged")
    || !cursorHookConfig.includes("AGENT_ACTIVITY_CONFIG_CONFLICT")) {
  errors.push("Cursor Agent CLI registration must preserve compare-and-swap and owned-entry conflict safety");
}
if (!bridgeInstaller.includes('"shell-file-intent.mjs"')
    || !bridgeInstaller.includes("async function isCurrent()")
    || !bridgeInstaller.includes("async function ensureCurrent()")
    || !hookRegistrationService.includes("await bridgeInstaller.ensureCurrent()")) {
  errors.push("enrolled Terminal sessions must atomically refresh the complete Hook bridge before launch");
}
if (!payloadProjector.includes("projectShellReadPaths")
    || !payloadProjector.includes("input.read_paths = shellReadPaths")) {
  errors.push("the Hook bridge must project conservative literal shell reads at the provider edge");
}
if (/transcript_path|transcriptPath/u.test(payloadProjector)) {
  errors.push("the Hook bridge must never treat Agent transcripts as an activity source");
}

if (errors.length > 0) {
  console.error("Agent activity architecture check failed:");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log("Agent activity architecture OK: neutral broker, six edge adapters, public Renderer boundary.");

function checkTree(relativeDirectory, patterns, message) {
  for (const filePath of sourceFiles(path.join(root, relativeDirectory))) {
    const source = readFileSync(filePath, "utf8");
    if (patterns.some((pattern) => pattern.test(source))) {
      errors.push(`${relative(filePath)}: ${message}`);
    }
  }
}

function requirePath(relativePath) {
  if (!existsSync(path.join(root, relativePath))) errors.push(`required file is missing: ${relativePath}`);
}

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function relative(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/");
}

function* sourceFiles(directory) {
  for (const entry of readdirSync(directory)) {
    const filePath = path.join(directory, entry);
    if (statSync(filePath).isDirectory()) yield* sourceFiles(filePath);
    else if (/\.(?:mjs|ts|tsx)$/u.test(entry)) yield filePath;
  }
}

function* files(directory) {
  for (const entry of readdirSync(directory)) {
    const filePath = path.join(directory, entry);
    if (statSync(filePath).isDirectory()) yield* files(filePath);
    else yield filePath;
  }
}
