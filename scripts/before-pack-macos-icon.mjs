import { buildMacosAppIcon, resolveMacosIconBuildInputs } from "../tooling/desktop/build/macos-app-icon.mjs";

export default async function prepareMacosIconBeforePack(context) {
  if (context.electronPlatformName !== "darwin") return;
  await buildMacosAppIcon(resolveMacosIconBuildInputs(context.packager.projectDir, context.packager.config));
}
