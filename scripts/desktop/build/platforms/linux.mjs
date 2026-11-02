export function applyLinuxBuilderConfig({ config, identity }) {
  return {
    ...config,
    linux: {
      category: "Office;Utility",
      mimeTypes: [`x-scheme-handler/${config.protocols[0].schemes[0]}`],
      executableName: identity.applicationName,
      target: ["AppImage"],
      artifactName: "puppyone-${version}-${arch}.${ext}",
    },
    appImage: {
      artifactName: "puppyone-${version}-${arch}.${ext}",
    },
  };
}
