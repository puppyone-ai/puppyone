/**
 * puppyone access <subcommand>
 *
 * Access layer — connect external systems with PuppyOne cloud.
 * Manages bidirectional sync between a local folder and a PuppyOne project.
 */

import { registerAgentSubcommands } from "./openclaw.js";
import { lsAction, psAction, accessStatusAction } from "./global.js";

export function registerAccess(program) {
  const access = program
    .command("access")
    .description("Connect a local folder with PuppyOne (sync daemon)");

  registerAgentSubcommands(access);

  access
    .command("ls")
    .description("List all access connections")
    .action(lsAction);

  access
    .command("ps")
    .description("List running sync daemon processes")
    .action(psAction);

  access
    .command("status")
    .description("Show detailed status for a connection (or all)")
    .argument("[path]", "workspace path (omit for all)")
    .action(accessStatusAction);
}
