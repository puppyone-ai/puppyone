import { createDesktopTargetFromNode } from "../../../shared/desktop/platform-contract.mjs";
import { createPlatformCapabilitySnapshot } from "./common/capability-snapshot.mjs";
import { createExecutableDiscoveryPort } from "./common/executable-discovery-port.mjs";
import { createCompanionAppPort } from "./macos/companion-apps.mjs";
import { createLinuxPlatformAdapter } from "./linux/index.mjs";
import { createMacosPlatformAdapter } from "./macos/index.mjs";
import { createWindowsPlatformAdapter } from "./windows/index.mjs";

export function createDesktopPlatformHost({
  nodePlatform = process.platform,
  nodeArch = process.arch,
  safeStorage = null,
  officeDocumentConverter,
} = {}) {
  const target = createDesktopTargetFromNode({ platform: nodePlatform, arch: nodeArch });
  const adapter = target.platform === "macos"
    ? createMacosPlatformAdapter({ arch: target.arch, officeDocumentConverter })
    : target.platform === "windows"
      ? createWindowsPlatformAdapter({ arch: target.arch })
      : createLinuxPlatformAdapter({ arch: target.arch });
  const capabilities = createPlatformCapabilitySnapshot({ adapter, safeStorage });
  return Object.freeze({
    target,
    platform: target.platform,
    arch: target.arch,
    windowChrome: adapter.windowChrome,
    documents: adapter.documents,
    executableDiscovery: createExecutableDiscoveryPort({ nodePlatform }),
    companionApps: createCompanionAppPort({ nodePlatform }),
    getCapabilities: () => capabilities,
  });
}
