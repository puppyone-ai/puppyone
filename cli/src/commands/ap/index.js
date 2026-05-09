import { registerAccessPointManagement } from "./profiles.js";
import { registerFsCommands } from "../fs/index.js";

export function registerAp(program) {
  const ap = program
    .command("ap")
    .description("Manage the active Access Point for scoped filesystem operations")
    .option("--access-key <key>", "Access Point key (or PUPPYONE_ACCESS_KEY)")
    .option("-u, --api-url <url>", "PuppyOne API URL for this access point")
    .option("--profile <name>", "Access Point profile override")
    .option("--mut-user <user>", "Acting user identity for user-bound access keys")
    .addHelpText("after", "\nAP also exposes fs subcommands for compatibility. Prefer `puppyone fs`; run `puppyone fs semantics` for agent-facing filesystem notes.");

  registerAccessPointManagement(ap);
  registerFsCommands(ap);
}
