import { AcpRuntimeAdapter } from "../../protocols/acp/acp-runtime-adapter.mjs";
import { WORKBUDDY_HOST_ENVIRONMENT } from "./workbuddy-environment.mjs";
import { WORKBUDDY_RUNTIME_DESCRIPTOR } from "./workbuddy-identity.mjs";
import { workBuddyChannel, workBuddyHistorySource } from "./workbuddy-history-source.mjs";

const AUTHENTICATION_METHOD_BY_CHANNEL = Object.freeze({
  china: "internal",
  "china-app": "internal",
  ioa: "iOA",
  selfhosted: "selfhosted",
  international: "external",
  "international-app": "external",
  "codebuddy-cli": "external",
});

export function workBuddyAuthenticationMethod(readiness = {}) {
  return AUTHENTICATION_METHOD_BY_CHANNEL[workBuddyChannel({
    executablePath: readiness.executablePath,
    environment: readiness.environment,
  })] ?? "external";
}

/** WorkBuddy product/profile policy around the shared ACP runtime core. */
export class WorkBuddyAcpAdapter extends AcpRuntimeAdapter {
  constructor(options) {
    const readiness = options.readiness ?? {};
    super({
      ...options,
      runtimeDescriptor: options.runtimeDescriptor ?? WORKBUDDY_RUNTIME_DESCRIPTOR,
      sourceScopeId: workBuddyHistorySource({
        executablePath: readiness.executablePath,
        environment: readiness.environment,
      }),
      accountType: "workbuddy",
      sessionTitles: { created: "New WorkBuddy session", resumed: "WorkBuddy session" },
      authenticationMethodId: workBuddyAuthenticationMethod(readiness),
      processArgs: () => [...(readiness.argsPrefix ?? []), "--acp"],
      environmentOverlay: () => WORKBUDDY_HOST_ENVIRONMENT,
      eventSource: "workbuddy-acp",
      referenceInputProfile: { embeddedText: true },
    });
  }
}
