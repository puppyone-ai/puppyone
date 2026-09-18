import { AcpRuntimeAdapter } from "../../protocols/acp/acp-runtime-adapter.mjs";
import { JsonlRpcErrorResponse } from "../../transports/jsonl-rpc-connection.mjs";
import { WORKBUDDY_HOST_ENVIRONMENT } from "./workbuddy-environment.mjs";
import { requireWorkBuddyChannel } from "./workbuddy-channels.mjs";
import { workBuddyConfigDirectory } from "./workbuddy-config-directory.mjs";
import { workBuddyHistorySource } from "./workbuddy-history-source.mjs";

/** WorkBuddy product/profile policy around the shared ACP runtime core. */
export class WorkBuddyAcpAdapter extends AcpRuntimeAdapter {
  constructor(options) {
    const channel = requireWorkBuddyChannel(options.channel);
    const readiness = options.readiness ?? {};
    super({
      ...options,
      runtimeDescriptor: options.runtimeDescriptor,
      sourceScopeId: workBuddyHistorySource({
        channel,
        environment: readiness.environment,
      }),
      accountType: channel.id,
      sessionTitles: {
        created: `New ${channel.displayName} session`,
        resumed: `${channel.displayName} session`,
      },
      authenticationMethodId: channel.authenticationMethodId,
      isAlreadyAuthenticated: workBuddyIsAlreadyAuthenticated,
      processArgs: () => [...(readiness.argsPrefix ?? []), "--acp"],
      environmentOverlay: ({ environment }) => {
        const configDirectory = workBuddyConfigDirectory({ channel, environment });
        return {
          ...WORKBUDDY_HOST_ENVIRONMENT,
          WORKBUDDY_CONFIG_DIR: configDirectory,
          CODEBUDDY_CONFIG_DIR: configDirectory,
          CODEBUDDY_INTERNET_ENVIRONMENT: channel.route,
        };
      },
      eventSource: `${channel.id}-acp`,
      referenceInputProfile: { embeddedText: true },
    });
  }
}

async function workBuddyIsAlreadyAuthenticated({ client }) {
  try {
    const response = await client.requestExtension("_codebuddy.ai/getUserInfo", {});
    return Boolean(response?.userInfo && typeof response.userInfo === "object");
  } catch (error) {
    // Older ACP builds may not expose the read-only identity extension. They
    // retain the previous explicit-authentication behavior as a safe fallback.
    if (error instanceof JsonlRpcErrorResponse && error.code === -32601) return false;
    throw error;
  }
}
