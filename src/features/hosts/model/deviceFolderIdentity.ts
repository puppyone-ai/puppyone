import { createResourceUri, createWorkspaceResourceUri, type ResourceUri } from "@puppyone/shared-ui";
import { resolveCloudApiBaseUrl } from "../../../../shared/cloudEndpoint.js";

/** Stable resource identity, not a connection ticket or a filesystem path. */
export type DeviceFolderRef = Readonly<{
  deployment: string;
  accountId: string;
  deviceId: string;
  folderId: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Never use a device name, local path, online state, or current connection epoch as an identity. */
export function deviceFolderRootUri(ref: DeviceFolderRef): ResourceUri {
  for (const label of ["accountId", "deviceId", "folderId"] as const) {
    if (!UUID.test(ref[label])) throw new TypeError(`${label} must be a UUID.`);
  }
  const deployment = new URL(resolveCloudApiBaseUrl(ref.deployment));
  if (deployment.username || deployment.password) throw new TypeError("Deployment credentials are not resource identity.");
  return createResourceUri({
    scheme: "puppyone-device",
    authority: deployment.host,
    path: [deployment.protocol.slice(0, -1), deployment.pathname.replace(/^\/+|\/+$/g, ""),
      ref.accountId.toLowerCase(), ref.deviceId.toLowerCase(), ref.folderId.toLowerCase()].join("/"),
  });
}

/** The existing resource URI service rejects absolute paths and root escape. */
export function deviceFolderResourceUri(ref: DeviceFolderRef, relativePath: string): ResourceUri {
  return createWorkspaceResourceUri(deviceFolderRootUri(ref), relativePath);
}
