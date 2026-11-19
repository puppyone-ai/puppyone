import type { HostFolderCapability, HostFolderRef } from "../../../../shared/host-contract/types";

/** A folder on another of the owner's computers; where it lives is part of the folder. */
export type HostFolderSelection = Readonly<{
  ref: HostFolderRef;
  name: string;
  /** The other computer's name, for "On {host}". */
  hostName: string;
  writable: boolean;
  /** What that computer allows in this folder, as last listed; refreshed when it opens. */
  capabilities?: readonly HostFolderCapability[];
}>;
