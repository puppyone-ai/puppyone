import { createResourceUri, type Workspace } from "@puppyone/shared-ui";
import type { NativeCloudDataService } from "./cloudDataPort";

/** An unavailable Cloud provider must never expose the local project's bytes. */
export function createPendingCloudDataService(identity: string | null, localWorkspaceName?: string): NativeCloudDataService {
  const uri = createResourceUri({ scheme: "puppyone-cloud", authority: "pending",
    path: encodeURIComponent(identity ?? "workspace") });
  const workspace: Workspace = { id: `cloud-pending:${uri}`, name: localWorkspaceName ?? "",
    path: uri, status: "recording" };
  const folder = { id: workspace.id, name: workspace.name, uri, index: 0,
    capabilities: { read: false, write: false, watch: false, execute: false },
    trustState: "untrusted" as const, workspace };
  return {
    workspace, folder, writable: false,
    invalidateReads: () => undefined,
    dataPort: {
      listChildren: async () => [],
      resolveNode: async () => null,
      readFile: async () => { throw new Error("Cloud file provider is unavailable."); },
    },
    resolveResource: (path) => !path || path === uri
      ? { folder, providerPath: "", resourceUri: uri }
      : null,
  };
}
