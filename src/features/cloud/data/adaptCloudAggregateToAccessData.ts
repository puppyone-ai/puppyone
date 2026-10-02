import type {
  DesktopCloudAccessSurface,
  DesktopCloudMcpEndpoint,
  DesktopCloudRepoIdentity,
  DesktopCloudScope,
} from "../../../lib/cloudApi";
import { buildAccessPointProjection } from "../access-points/model";
import type { CloudProjectAccessData } from "../project/cloudProjectAccessData";
import type { CloudMessageDescriptor } from "../cloudPresentation";

/** Adapt aggregate Cloud project details into Access/Automation view state without refetching. */
export function adaptCloudAggregateToAccessData({
  apiBaseUrl,
  scopes,
  connectors,
  mcpEndpoints,
  identity,
  loading,
  error,
  warning,
  reload,
}: {
  apiBaseUrl: string | null;
  scopes: DesktopCloudScope[];
  connectors: DesktopCloudAccessSurface[];
  mcpEndpoints: DesktopCloudMcpEndpoint[];
  identity: DesktopCloudRepoIdentity | null;
  loading: boolean;
  error: CloudMessageDescriptor | null;
  warning: CloudMessageDescriptor | null;
  reload: () => Promise<void>;
}): CloudProjectAccessData {
  const projection = buildAccessPointProjection({
    scopes,
    connectors,
    mcpEndpoints,
    identity,
    apiBaseUrl,
  });

  return {
    scopes,
    scopeRows: projection.scopeRows,
    connectors,
    connectorsByTarget: projection.connectorsByTarget,
    mcpEndpoints,
    mcpEndpointsByTarget: projection.mcpEndpointsByTarget,
    accessPointRows: projection.accessPointRows,
    identity,
    loading,
    error,
    warning,
    reload,
  };
}
