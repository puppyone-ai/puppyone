import { startAgentItemHost } from "../../electron/utility/agent/item-host.mjs";
import { createFixtureAgentRuntime } from "./item-agent-runtime.mjs";

startAgentItemHost({ createRuntimeRegistry: createFixtureAgentRuntime });
