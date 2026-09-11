import path from "node:path";
import { resolveMacosIconBuildInputs, verifyMacosAppIcon } from "../tooling/desktop/build/macos-app-icon.mjs";

export default async function verifyMacosIconAfterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  await verifyMacosAppIcon(
    path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`),
    resolveMacosIconBuildInputs(context.packager.projectDir, context.packager.config),
  );
}
