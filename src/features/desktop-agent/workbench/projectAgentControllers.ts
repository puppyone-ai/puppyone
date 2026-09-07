import type { AuxiliaryWorkbenchProject } from "../../app-shell/auxiliary-workbench/types";
import { AgentControllerRegistry } from "../application/AgentControllerRegistry";
import { createProjectAgentClientProvider } from "../infrastructure/electron/electronAgentClient";

/** One registry per opened project generation, shared by every Chat Item. */
export function projectAgentControllers(project: AuxiliaryWorkbenchProject) {
  return project.getResource("agent", () => new AgentControllerRegistry(
    project.context.rootPath,
    () => createProjectAgentClientProvider(project.context),
  ));
}
