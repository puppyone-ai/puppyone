import { resolveDesktopAppIcon } from "../../../../shared/desktop/app-icon-contract.mjs";

export function applyWindowsBuilderConfig({ config, identity }) {
  return {
    ...config,
    win: {
      target: ["nsis"],
      executableName: identity.applicationName,
      icon: resolveDesktopAppIcon(identity.release.channel).source,
      artifactName: "puppyone-${version}-${arch}-setup.${ext}",
      signtoolOptions: {
        signingHashAlgorithms: ["sha256"],
      },
    },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      artifactName: "puppyone-${version}-${arch}-setup.${ext}",
    },
  };
}
