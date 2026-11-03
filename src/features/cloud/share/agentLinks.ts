import { cloudApiRequest, type DesktopCloudSession } from "../../../lib/cloudApi";

/** Who a link lets in: an Agent its owner signs in for, or any Agent holding it. */
export type AgentAdmission = "sign_in" | "link";
export type ConnectedAgent = Readonly<{
  id: string;
  name: string;
  admission: AgentAdmission;
  grant_id: string;
  connected_at: string;
  expires_at: string | null;
}>;
/** An Agent that followed a sign-in link and waits for the owner to allow it. */
export type AgentRequest = Readonly<{
  id: string;
  name: string;
  admission: AgentAdmission;
  requested_at: string;
  expires_at: string;
}>;
export type AgentLinkInventory = Readonly<{
  links: readonly Readonly<{ id: string; admission: AgentAdmission; expires_at: string }>[];
  /** The deployment decides whether a link may admit without sign-in. Absent means no. */
  open_links_enabled?: boolean;
  connections: readonly ConnectedAgent[];
  /** Only the requests the owner can still allow. Absent from servers that predate it. */
  pending?: readonly AgentRequest[];
}>;

/** One connection to the workspace. An Agent opens one for each command it runs. */
export type AgentSession = Readonly<{
  grant_id: string;
  state: "active" | "stopping" | "closed";
  created_at: string;
  closed_at: string | null;
  lease_until: string;
}>;

const projectPath = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`;

function invitationSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "pai_" + btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** The owner's workspace proves who may share; an admitted Agent gets a machine of its own. */
export async function createAgentLink(session: DesktopCloudSession, projectId: string,
  admission: AgentAdmission, apiBaseUrl: string): Promise<string> {
  const { workspace } = await cloudApiRequest<{ workspace: { id: string } | null }>(
    `${projectPath(projectId)}/workbench`, session, undefined, {}, apiBaseUrl);
  if (!workspace) throw Object.assign(new Error("This project has no hosted workspace."), { status: 409 });
  const { agent_url: url } = await cloudApiRequest<{ agent_url: string }>(`${projectPath(projectId)}/agent-links`,
    session, undefined, { method: "POST", body: JSON.stringify({
      id: crypto.randomUUID(), secret: invitationSecret(), workbench_id: workspace.id, admission,
    }) }, apiBaseUrl);
  return url;
}

export function listAgentLinks(session: DesktopCloudSession, projectId: string, apiBaseUrl: string) {
  return cloudApiRequest<AgentLinkInventory>(`${projectPath(projectId)}/agent-links`, session, undefined, {}, apiBaseUrl);
}

export function listAgentSessions(session: DesktopCloudSession, projectId: string, apiBaseUrl: string) {
  return cloudApiRequest<readonly AgentSession[]>(`${projectPath(projectId)}/access/sessions`, session, undefined, {}, apiBaseUrl);
}

export function removeConnectedAgent(session: DesktopCloudSession, projectId: string, grantId: string, apiBaseUrl: string) {
  return cloudApiRequest<unknown>(`${projectPath(projectId)}/access/grants/${encodeURIComponent(grantId)}`, session,
    undefined, { method: "PATCH", body: JSON.stringify({ state: "revoked" }) }, apiBaseUrl);
}

/** The owner's answer to a waiting Agent; allowing one ends the wait of others on its link. */
export function decideAgentRequest(session: DesktopCloudSession, connectionId: string,
  decision: "approve" | "reject", apiBaseUrl: string) {
  return cloudApiRequest<unknown>(`/agent-links/connections/${encodeURIComponent(connectionId)}/decision`, session,
    undefined, { method: "POST", body: JSON.stringify({ decision }) }, apiBaseUrl);
}

export function stopSharingWithAgents(session: DesktopCloudSession, projectId: string, apiBaseUrl: string) {
  return cloudApiRequest<unknown>(`${projectPath(projectId)}/agent-links`, session, undefined, { method: "DELETE" }, apiBaseUrl);
}

/**
 * What the person pastes. Their own message is what asks the Agent to act, so it
 * says what they want in one line; the link carries the steps, and the owner
 * allows the Agent in puppyone. It stays in English because it is read by the
 * Agent, not shown in the product.
 */
export function agentConnectMessage(projectName: string, url: string) {
  return `Connect to my puppyone project "${projectName}" by following ${url}`;
}
