import { AgentActivityStore } from "./agentActivityStore";
import { agentActivityApi } from "./agentActivityApi";

export { AgentFilePresence } from "./AgentFilePresence";
export { AgentChangedFileMark } from "./AgentChangedFileMark";
export { agentChangedFilesStore } from "./agentChangedFilesStore";
export { observeAgentChangedFiles } from "./observeAgentChangedFiles";
export { useAgentFileReview } from "./useAgentFileReview";
export { toWorkspaceRelativePath } from "./agentActivity";
export type {
  AgentFilePresenceClaim,
  AgentFilePresenceProjection,
} from "./agentActivity";

export const desktopAgentActivityStore = new AgentActivityStore(agentActivityApi);
