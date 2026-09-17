import { openCodeHistorySource } from "./opencode-history-source.mjs";
import { AcpRuntimeAdapter } from "../../protocols/acp/acp-runtime-adapter.mjs";
import { buildAcpPromptBlocks } from "../../protocols/acp/acp-prompt-input.mjs";

export { buildAcpPromptBlocks as buildPromptBlocks };

/** OpenCode policy/profile around the shared ACP runtime core. */
export class OpenCodeAcpAdapter extends AcpRuntimeAdapter {
  constructor(options) {
    super({
      ...options,
      sourceScopeId: openCodeHistorySource(options.readiness?.environment ?? process.env),
      accountType: "opencode-native",
      sessionTitles: { created: "New OpenCode session", resumed: "OpenCode session" },
      processArgs: ({ workspaceRoot }) => [
        "acp",
        `--cwd=${workspaceRoot}`,
      ],
      environmentOverlay: ({ mode }) => ({
        ...(mode === "metadata" ? { OPENCODE_DB: ":memory:" } : {}),
      }),
      eventSource: "opencode-acp",
      referenceInputProfile: { embeddedText: true },
    });
  }
}
