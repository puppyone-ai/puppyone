#!/usr/bin/env node

import { program } from "commander";
import { version } from "../src/version.js";

// Primary command groups
import { registerAuth, registerLegacyAuthAliases } from "../src/commands/auth.js";
import { registerOrg } from "../src/commands/org.js";
import { registerProject } from "../src/commands/project.js";
import { registerFs } from "../src/commands/fs.js";
import { registerSync } from "../src/commands/sync.js";
import { registerIngest } from "../src/commands/ingest.js";
import { registerTable } from "../src/commands/table.js";
import { registerTool } from "../src/commands/tool.js";
import { registerAgent } from "../src/commands/agent-cmd.js";
import { registerMcp } from "../src/commands/mcp.js";
import { registerConfig } from "../src/commands/config-cmd.js";
import { registerPublish } from "../src/commands/publish.js";
import { registerDb } from "../src/commands/db.js";
import { registerSandbox } from "../src/commands/sandbox.js";
import { registerAccess } from "../src/commands/access.js";
import { registerConnection } from "../src/commands/connection.js";
import { registerInit } from "../src/commands/init.js";

// Backward-compat aliases
import { registerOpenClaw } from "../src/commands/openclaw.js";
import { registerGlobalCommands } from "../src/commands/global.js";

program
  .name("puppyone")
  .description("PuppyOne CLI — cloud file system for LLM agents")
  .version(version, "-V, --version");

program
  .option("-u, --api-url <url>", "PuppyOne API URL (overrides config)")
  .option("-k, --api-key <key>", "API key / token (overrides config)")
  .option("--json", "output as JSON (for AI / scripts)")
  .option("-v, --verbose", "verbose output")
  .option("-p, --project <id>", "project ID (overrides active project)")
  .option("-o, --org <id>", "organization ID (overrides active org)");

// ─── Primary Commands ─────────────────────────────────────
registerAuth(program);
registerOrg(program);
registerProject(program);
registerFs(program);
registerSync(program);
registerIngest(program);
registerTable(program);
registerTool(program);
registerAgent(program);
registerMcp(program);
registerConfig(program);
registerPublish(program);
registerDb(program);
registerSandbox(program);
registerAccess(program);
registerConnection(program);
registerInit(program);

// ─── Backward Compatibility ──────────────────────────────
registerOpenClaw(program);
registerLegacyAuthAliases(program);
registerGlobalCommands(program);

program.parse();
