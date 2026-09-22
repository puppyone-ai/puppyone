import os from "node:os";
import path from "node:path";
import { createOwnedJsonHookConfig } from "./owned-config-mutation.mjs";
import { createOwnedCursorCliHookConfig } from "./cursor-cli-hook-config.mjs";

const PROVIDERS = Object.freeze([
  Object.freeze({ providerId: "codex", displayName: "Codex", configurable: true }),
  Object.freeze({ providerId: "claude", displayName: "Claude Code", configurable: true }),
  Object.freeze({ providerId: "cursor", displayName: "Cursor Agent CLI", configurable: true }),
  Object.freeze({ providerId: "opencode", displayName: "OpenCode", configurable: false }),
  Object.freeze({ providerId: "pi", displayName: "Pi Agent", configurable: false }),
  Object.freeze({ providerId: "hermes", displayName: "Hermes Agent", configurable: false }),
]);

export function createHookRegistrationService({ bridgeInstaller, homedir = os.homedir() }) {
  const registrations = new Map([
    ["codex", createOwnedJsonHookConfig({
      configPath: path.join(homedir, ".codex", "hooks.json"),
      providerId: "codex",
      command: providerBridgeCommand(bridgeInstaller.command, "codex"),
    })],
    ["claude", createOwnedJsonHookConfig({
      configPath: path.join(homedir, ".claude", "settings.json"),
      providerId: "claude",
      command: providerBridgeCommand(bridgeInstaller.command, "claude"),
    })],
    ["cursor", createOwnedCursorCliHookConfig({
      configPath: path.join(homedir, ".cursor", "hooks.json"),
      command: providerBridgeCommand(bridgeInstaller.command, "cursor"),
    })],
  ]);

  async function getSnapshot() {
    // Inspection is deliberately read-only: discovering an Agent never opts the
    // user into its Hook. A Hook is enabled only after setEnabled(..., true).
    const providers = await Promise.all(PROVIDERS.map(async (provider) => {
      const registration = registrations.get(provider.providerId);
      let enrollment = registration
        ? (await registration.inspect()).enrollment
        : "basic-only";
      if (enrollment === "enabled" && !(await bridgeInstaller.isCurrent())) {
        enrollment = "needs-repair";
      }
      return Object.freeze({ ...provider, enrollment });
    }));
    return Object.freeze({ schemaVersion: 1, providers: Object.freeze(providers) });
  }

  async function setEnabled(providerId, enabled) {
    const registration = registrations.get(providerId);
    if (!registration) throw new Error("AGENT_ACTIVITY_PROVIDER_BASIC_ONLY");
    if (enabled) {
      await bridgeInstaller.install();
      return registration.enable();
    }
    return registration.disable();
  }

  async function isEnabled(providerId) {
    const registration = registrations.get(providerId);
    if (!registration || (await registration.inspect()).enrollment !== "enabled") return false;
    await bridgeInstaller.ensureCurrent();
    return true;
  }

  async function hasAnyEnabled() {
    for (const providerId of registrations.keys()) {
      if (await isEnabled(providerId)) return true;
    }
    return false;
  }

  return Object.freeze({ getSnapshot, setEnabled, isEnabled, hasAnyEnabled });
}

function providerBridgeCommand(command, providerId) {
  return `${command} --provider ${providerId}`;
}
