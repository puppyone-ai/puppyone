#!/usr/bin/env node

import { program } from "commander";
import { version } from "../src/version.js";

// New command groups (primary)
import { registerAuth, registerLegacyAuthAliases } from "../src/commands/auth.js";
import { registerAccess } from "../src/commands/access.js";

// Backward-compat aliases
import { registerOpenClaw } from "../src/commands/openclaw.js";
import { registerGlobalCommands } from "../src/commands/global.js";

// Legacy commands (to be deprecated)
import { registerConnect } from "../src/commands/connect.js";
import { registerSync } from "../src/commands/sync.js";
import { registerWatch } from "../src/commands/watch.js";
import { registerPull } from "../src/commands/pull.js";
import { registerDisconnect } from "../src/commands/disconnect.js";

program
  .name("puppyone")
  .description("PuppyOne CLI — cloud file system for LLM agents")
  .version(version, "-V, --version");

program
  .option("-u, --api-url <url>", "PuppyOne API URL (overrides config)")
  .option("-k, --api-key <key>", "API key / token (overrides config)")
  .option("--json", "output as JSON (for AI / scripts)")
  .option("-v, --verbose", "verbose output");

// Primary command groups
registerAuth(program);
registerAccess(program);

// Backward-compat: `puppyone openclaw *` = `puppyone access agent *`
registerOpenClaw(program);

// Backward-compat: `puppyone login/logout/whoami` (hidden)
registerLegacyAuthAliases(program);

// Backward-compat: top-level `puppyone ps`, `puppyone status`
registerGlobalCommands(program);

// Legacy commands
registerConnect(program);
registerSync(program);
registerWatch(program);
registerPull(program);
registerDisconnect(program);

program.parse();
