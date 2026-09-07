import { openCodeHistorySource } from "./opencode-history-source.mjs";
import {
  AcpRuntimeAdapter,
  mergeJsonConfig,
} from "../../protocols/acp/acp-runtime-adapter.mjs";
import { buildAcpPromptBlocks } from "../../protocols/acp/acp-prompt-input.mjs";
import { managedOpenCodeAcpConfig } from "./opencode-security-policy.mjs";

export { buildAcpPromptBlocks as buildPromptBlocks };

/** OpenCode policy/profile around the shared ACP runtime core. */
export class OpenCodeAcpAdapter extends AcpRuntimeAdapter {
  constructor(options) {
    super({
      ...options,
      sourceScopeId: openCodeHistorySource(options.readiness?.environment ?? process.env),
      accountType: options.managed ? "puppyone-agent" : "opencode-native",
      sessionTitles: options.managed
        ? { created: "New PuppyOne Agent session", resumed: "PuppyOne Agent session" }
        : { created: "New OpenCode session", resumed: "OpenCode session" },
      processArgs: ({ workspaceRoot, managed }) => [
        "acp",
        `--cwd=${workspaceRoot}`,
        ...(managed ? ["--hostname=127.0.0.1", "--port=0", "--pure"] : []),
      ],
      environmentOverlay: ({ environment, mode, managed }) => ({
        ...(mode === "metadata" ? { OPENCODE_DB: ":memory:" } : {}),
        ...(managed ? {
          OPENCODE_CONFIG_CONTENT: mergeJsonConfig(
            environment.OPENCODE_CONFIG_CONTENT,
            managedOpenCodeAcpConfig(),
          ),
        } : {}),
      }),
      eventSource: "opencode-acp",
      referenceInputProfile: { embeddedText: true },
    });
  }
}
