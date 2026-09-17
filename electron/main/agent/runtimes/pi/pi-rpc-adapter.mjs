import {
  PI_CAPABILITIES,
  PiRpcRuntimeAdapter,
  normalizePiModels,
} from "../../protocols/pi-rpc/pi-rpc-runtime-adapter.mjs";
import { PI_RUNTIME_DESCRIPTOR } from "./pi-identity.mjs";
import { piHistorySource } from "./pi-history-source.mjs";

/** User-owned Pi CLI route. Its profile, extensions and sessions remain Pi-owned. */
export class PiRpcAdapter extends PiRpcRuntimeAdapter {
  constructor(options = {}) {
    super({
      ...options,
      runtimeDescriptor: options.runtimeDescriptor ?? PI_RUNTIME_DESCRIPTOR,
      historySource: options.historySource ?? piHistorySource(options.readiness?.environment ?? process.env),
      runtimeLabel: "Pi",
      runtimeNamespace: "pi",
      providerSource: "pi",
      accountType: "pi",
      capabilities: PI_CAPABILITIES,
      runtimeSetupMessage: "Pi has no authenticated model providers. Configure one in Pi, then refresh.",
    });
  }
}

export { PI_CAPABILITIES, normalizePiModels };
