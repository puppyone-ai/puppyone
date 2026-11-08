import {
  resolveDesktopApplicationIdentity,
} from "../../../shared/desktop/application-identity.mjs";
import { createDesktopTarget } from "../../../shared/desktop/platform-contract.mjs";
import {
  assertDesktopBuildInfo,
  toDesktopReleaseIdentity,
} from "../../../shared/desktop-build-identity.mjs";
import { getDesktopTargetDefinition } from "../targets/target-manifest.mjs";
import { applyLinuxBuilderConfig } from "./platforms/linux.mjs";
import { applyMacosBuilderConfig } from "./platforms/macos.mjs";
import { applyWindowsBuilderConfig } from "./platforms/windows.mjs";
import { resolveDesktopAppIcon } from "../../../shared/desktop/app-icon-contract.mjs";
import { getDesktopReturnScheme } from "../../../shared/desktop/return-to-app-link.mjs";
import { resolveLocalDisplayName } from "../../../shared/desktop/local-display-name.mjs";

const DEFAULT_MAC_TARGET = createDesktopTarget({ platform: "macos", arch: "arm64" });
const PLATFORM_CONFIG_KEYS = Object.freeze([
  "beforePack",
  "afterPack",
  "mac",
  "dmg",
  "win",
  "nsis",
  "linux",
  "appImage",
]);

export function createDesktopElectronBuilderConfig({
  packageMetadata,
  buildInfo,
  buildInfoPath = "generated/desktop-build-info.json",
  target = DEFAULT_MAC_TARGET,
  displayName = null,
}) {
  const legacyBuildInfo = assertDesktopBuildInfo(buildInfo);
  const release = toDesktopReleaseIdentity(legacyBuildInfo);
  const targetDefinition = getDesktopTargetDefinition(target);
  const application = resolveDesktopApplicationIdentity({
    releaseIdentity: release,
    target: targetDefinition,
  });
  const packageName = resolveLocalDisplayName({ channel: release.channel, displayName, fallback: application.applicationName });
  if (displayName != null && targetDefinition.platform !== "macos") {
    throw new Error("Local display names are currently supported only for macOS packages.");
  }
  const baseBuild = structuredClone(packageMetadata?.build ?? {});
  const baseConfig = stripPlatformConfig(baseBuild);
  const appImageSource = resolveDesktopAppIcon(release.channel).source;
  const extraResources = createManagedExtraResources({
    baseBuild,
    appImageSource,
    buildInfoPath,
  });
  const identity = Object.freeze({ ...application, displayName: packageName, release });
  const config = {
    ...baseConfig,
    appId: application.applicationId,
    productName: packageName,
    executableName: packageName,
    artifactName: "puppyone-${version}-${arch}.${ext}",
    buildVersion: application.platformBuildNumber ?? release.baseVersion,
    protocols: [{
      name: `Open ${packageName}`,
      schemes: [getDesktopReturnScheme(release.channel)],
      role: "Viewer",
    }],
    extraMetadata: {
      ...(baseBuild.extraMetadata ?? {}),
      version: release.version,
      // Electron reads productName before our entry module. Keep its keychain
      // name stable even when macOS and our windows use a different label.
      ...(displayName == null ? {} : {
        productName: application.applicationName,
        puppyoneLocalDisplayName: packageName,
      }),
    },
    extraResources,
    publish: application.updateFeedUrl
      ? [{
          provider: "generic",
          url: application.updateFeedUrl,
          channel: application.updateChannel,
        }]
      : [],
  };

  if (targetDefinition.platform === "macos") {
    return applyMacosBuilderConfig({ config, baseBuild, identity });
  }
  if (targetDefinition.platform === "windows") {
    return applyWindowsBuilderConfig({ config, baseBuild, identity });
  }
  return applyLinuxBuilderConfig({ config, baseBuild, identity });
}

function stripPlatformConfig(baseBuild) {
  const config = structuredClone(baseBuild);
  for (const key of PLATFORM_CONFIG_KEYS) delete config[key];
  return config;
}

function createManagedExtraResources({ baseBuild, appImageSource, buildInfoPath }) {
  const extraResources = Array.isArray(baseBuild.extraResources)
    ? [...baseBuild.extraResources]
    : [];
  const resources = extraResources.filter((entry) => (
    entry?.to !== "build-info.json" && entry?.to !== "puppy-app-image.png"
  ));
  resources.push({ from: appImageSource, to: "puppy-app-image.png" });
  resources.push({ from: buildInfoPath, to: "build-info.json" });
  return resources;
}
