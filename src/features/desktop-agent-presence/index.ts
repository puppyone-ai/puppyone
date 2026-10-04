import { AgentActivityStore } from "./agentActivityStore";
import { agentActivityApi } from "./agentActivityApi";

export { AgentFilePresence } from "./AgentFilePresence";
export { toWorkspaceRelativePath } from "./agentActivity";
export type {
  AgentFilePresenceClaim,
  AgentFilePresenceProjection,
} from "./agentActivity";

export const desktopAgentActivityStore = new AgentActivityStore(agentActivityApi);
