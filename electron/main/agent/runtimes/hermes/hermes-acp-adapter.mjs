import { AcpRuntimeAdapter } from "../../protocols/acp/acp-runtime-adapter.mjs";
import { HERMES_RUNTIME_DESCRIPTOR } from "./hermes-identity.mjs";
import { hermesHistorySource } from "./hermes-history-source.mjs";

export function hermesAuthenticationMethod(authMethods = []) {
  return authMethods.find((method) => (
    typeof method?.id === "string"
    && method.id
    && method.type !== "terminal"
  ))?.id ?? null;
}

/** Hermes product policy around the shared first-party ACP runtime core. */
export class HermesAcpAdapter extends AcpRuntimeAdapter {
  constructor(options) {
    const readiness = options.readiness ?? {};
    super({
      ...options,
      runtimeDescriptor: options.runtimeDescriptor ?? HERMES_RUNTIME_DESCRIPTOR,
      sourceScopeId: hermesHistorySource(readiness.environment),
      accountType: "hermes",
      sessionTitles: { created: "New Hermes session", resumed: "Hermes session" },
      authenticationMethodSelector: hermesAuthenticationMethod,
      processArgs: () => [...(readiness.argsPrefix ?? []), "acp"],
      eventSource: "hermes-acp",
    });
  }
}
