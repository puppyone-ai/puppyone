import { AcpRuntimeAdapter } from "../../protocols/acp/acp-runtime-adapter.mjs";
import { WORKBUDDY_HOST_ENVIRONMENT } from "./workbuddy-environment.mjs";
import { requireWorkBuddyChannel } from "./workbuddy-channels.mjs";
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
      processArgs: () => [...(readiness.argsPrefix ?? []), "--acp"],
      environmentOverlay: ({ environment }) => ({
        ...WORKBUDDY_HOST_ENVIRONMENT,
        CODEBUDDY_INTERNET_ENVIRONMENT: channel.route,
        ...(environment[channel.configDirectoryEnvironmentVariable]
          ? { CODEBUDDY_CONFIG_DIR: environment[channel.configDirectoryEnvironmentVariable] }
          : {}),
      }),
      eventSource: `${channel.id}-acp`,
      referenceInputProfile: { embeddedText: true },
    });
  }
}
