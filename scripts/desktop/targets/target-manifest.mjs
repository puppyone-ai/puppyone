import { assertDesktopTarget, createDesktopTarget } from "../../../shared/desktop/platform-contract.mjs";

export const DESKTOP_TARGET_MANIFEST_SCHEMA_VERSION = 1;
export const DESKTOP_TARGET_PARTICIPATION = Object.freeze(["required", "optional", "disabled"]);

const TARGETS = deepFreeze([
  {
    ...createDesktopTarget({ platform: "macos", arch: "arm64" }),
    runner: "macos-15",
    packageTargets: ["dmg", "zip"],
    updateTrack: "squirrel",
    upstreamRuntimeKey: "darwin-arm64",
    verifier: "macos",
    participation: { internal: "required", stable: "required" },
  },
  {
    ...createDesktopTarget({ platform: "windows", arch: "x64" }),
    runner: "windows-2025",
    packageTargets: ["nsis"],
    updateTrack: "nsis",
    upstreamRuntimeKey: "win32-x64",
    verifier: "windows",
    participation: { internal: "optional", stable: "required" },
  },
  {
    ...createDesktopTarget({ platform: "linux", arch: "x64" }),
    runner: "ubuntu-24.04",
    packageTargets: ["AppImage"],
    updateTrack: "appimage",
    upstreamRuntimeKey: "linux-x64",
    verifier: "linux",
    participation: { internal: "optional", stable: "disabled" },
  },
]);

const TARGETS_BY_ID = new Map(TARGETS.map((target) => [target.id, target]));

export function listDesktopTargets() {
  return TARGETS;
}

export function getDesktopTargetDefinition(target) {
  const normalized = typeof target === "string"
    ? TARGETS_BY_ID.get(target)
    : TARGETS_BY_ID.get(assertDesktopTarget(target).id);
  if (!normalized) throw new Error(`Desktop target is not declared: ${typeof target === "string" ? target : target?.id}`);
  return normalized;
}

export function createDesktopCiMatrix({ scope = "contracts", channel = null } = {}) {
  if (scope !== "contracts" && scope !== "release") {
    throw new Error(`Unsupported Desktop target matrix scope: ${String(scope)}`);
  }
  if (scope === "release" && channel !== "internal" && channel !== "stable") {
    throw new Error("Desktop release target matrix requires internal or stable channel.");
  }
  const targets = scope === "contracts"
    ? TARGETS
    : TARGETS.filter((target) => target.participation[channel] !== "disabled");
  return deepFreeze({
    include: targets.map((target) => ({
      id: target.id,
      platform: target.platform,
      arch: target.arch,
      runner: target.runner,
      updateTrack: target.updateTrack,
      participation: channel ? target.participation[channel] : "contracts",
    })),
  });
}

export function assertDesktopTargetManifest() {
  const errors = [];
  const ids = new Set();
  for (const target of TARGETS) {
    if (ids.has(target.id)) errors.push(`duplicate target id: ${target.id}`);
    ids.add(target.id);
    if (!/^[-a-z0-9.]+$/.test(target.runner)) errors.push(`${target.id} has invalid runner`);
    if (!Array.isArray(target.packageTargets) || target.packageTargets.length === 0) {
      errors.push(`${target.id} must declare package targets`);
    }
    for (const channel of ["internal", "stable"]) {
      if (!DESKTOP_TARGET_PARTICIPATION.includes(target.participation[channel])) {
        errors.push(`${target.id} has invalid ${channel} participation`);
      }
    }
  }
  if (!TARGETS.some((target) => target.platform === "macos" && target.participation.stable === "required")) {
    errors.push("the shipped macOS Stable target must remain required");
  }
  if (!TARGETS.some((target) => target.platform === "windows" && target.participation.stable === "required")) {
    errors.push("the shipped Windows Stable target must remain required");
  }
  if (errors.length > 0) {
    throw new Error(`Invalid Desktop target manifest:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
  return TARGETS;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
