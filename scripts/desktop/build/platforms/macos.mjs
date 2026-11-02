import { resolveDesktopAppIcon } from "../../../../shared/desktop/app-icon-contract.mjs";

/**
 * Files Desktop offers to open on their own. `Alternate` joins the system's
 * list without claiming the user's default app. A declaration's content types
 * override its extensions, so anything matched by extension needs its own entry.
 */
const FILE_MODE_DOCUMENT_TYPES = Object.freeze([
  { CFBundleTypeName: "Markdown", LSItemContentTypes: ["net.daringfireball.markdown"] },
  { CFBundleTypeName: "CSV", LSItemContentTypes: ["public.comma-separated-values-text"] },
  { CFBundleTypeName: "HTML", LSItemContentTypes: ["public.html"] },
].map((type) => ({ ...type, CFBundleTypeRole: "Editor", LSHandlerRank: "Alternate" })));

export function applyMacosBuilderConfig({ config, baseBuild, identity }) {
  return {
    ...config,
    beforePack: "scripts/before-pack-macos-icon.mjs",
    afterPack: "scripts/after-pack-macos-icon.mjs",
    mac: {
      category: "public.app-category.productivity",
      hardenedRuntime: true,
      gatekeeperAssess: false,
      strictVerify: true,
      notarize: true,
      ...(baseBuild.mac ?? {}),
      icon: resolveDesktopAppIcon(identity.release.channel).macos,
      executableName: identity.applicationName,
      bundleShortVersion: identity.release.baseVersion,
      bundleVersion: identity.platformBuildNumber ?? identity.release.baseVersion,
      ...(identity.release.channel === "stable"
        ? {}
        : {
            identity: "-",
            hardenedRuntime: false,
            notarize: false,
            strictVerify: false,
          }),
      extendInfo: {
        ...(baseBuild.mac?.extendInfo ?? {}),
        CFBundleName: identity.applicationName,
        CFBundleDisplayName: identity.applicationName,
        CFBundleDocumentTypes: FILE_MODE_DOCUMENT_TYPES,
      },
      target: ["dmg", "zip"],
    },
    dmg: {
      title: "${productName} Installer",
      background: "assets/installer/dmg-background.tiff",
      iconSize: 128,
      iconTextSize: 14,
      window: { width: 720, height: 440 },
      contents: [
        { x: 200, y: 204 },
        { x: 520, y: 204, type: "link", path: "/Applications" },
      ],
      ...(baseBuild.dmg ?? {}),
      artifactName: "puppyone-${version}-${arch}.${ext}",
    },
  };
}
