#!/usr/bin/env node

import { program } from "commander";
import { registerLogin, registerLogout, registerWhoami } from "../src/commands/login.js";
import { registerConnect } from "../src/commands/connect.js";
import { registerSync } from "../src/commands/sync.js";
import { registerWatch } from "../src/commands/watch.js";

program
  .name("puppyone")
  .description("PuppyOne CLI — sync local folders with PuppyOne cloud projects")
  .version("0.1.0", "-V, --version");

program
  .option("-u, --api-url <url>", "PuppyOne API URL (overrides config)")
  .option("-k, --api-key <key>", "API key / token (overrides config)")
  .option("--json", "output as JSON (for AI / scripts)")
  .option("-v, --verbose", "verbose output");

registerLogin(program);
registerLogout(program);
registerWhoami(program);
registerConnect(program);
registerSync(program);
registerWatch(program);

program.parse();
