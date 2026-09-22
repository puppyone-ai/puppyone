import { spawn as nodeSpawn } from "node:child_process";
import { connectionError, modelRoute, parseModelRoute } from "../../../../../shared/model-connections/schema.mjs";
import { stripPuppyOneProviderCredentials } from "./puppyone-agent-environment.mjs";
import { PiRpcClient } from "../../protocols/pi-rpc/pi-rpc-client.mjs";

export function connectionModels(snapshot) {
  return snapshot.connections.flatMap((connection) => {
    const catalog = snapshot.catalogs.find((entry) => entry.connectionId === connection.id);
    if (catalog?.status !== "ready" || catalog.configGeneration !== connection.configGeneration) return [];
    if (connection.driver === "unsloth" && !connection.serverToolsDisabled) return [];
    return catalog.models.filter((model) => model.available && model.contextWindow && model.capabilities.text === "supported" && model.capabilities.tools === "supported").map((model) => ({
      id: modelRoute(connection.id, model.id), model: modelRoute(connection.id, model.id),
      modelId: model.id, providerId: connection.id, connectionId: connection.id,
      displayName: model.name, description: connection.name,
      isDefault: connection.defaultModelId === model.id,
      contextWindow: model.contextWindow, modelCapabilities: model.capabilities, variants: [], defaultVariant: null,
    }));
  });
}

/** Private pipe bootstrap, never argv, environment, RPC history or a plaintext file. */
export function spawnWithModelConfiguration(configuration, spawn = nodeSpawn) {
  return (executable, args, options) => {
    const child = spawn(executable, args, {
      ...options,
      env: { ...stripPuppyOneProviderCredentials(options.env), PUPPYONE_MODEL_CONNECTION_BOOTSTRAP: "1", PI_OFFLINE: "1" },
      stdio: ["pipe", "pipe", "pipe", "pipe"],
    });
    const pipe = child.stdio?.[3];
    if (!pipe) { child.kill(); throw connectionError("AUTHORITY_REQUIRED"); }
    pipe.on("error", () => { child.kill(); });
    // The pipe closes after one bounded envelope. It is not inherited by tool processes.
    pipe.end(JSON.stringify(configuration));
    return child;
  };
}

export function createModelConnectionBinding(port) {
  let lease = null;
  let disposed = false;
  let readOnly = false;
  return {
    get configuration() { return lease?.configuration ?? null; },
    enableReadOnly() { if (lease) throw connectionError("AUTHORITY_REQUIRED"); readOnly = true; },
    async acquire(route) {
      if (disposed) throw connectionError("LEASE_REVOKED");
      if (lease) {
        await this.validate(route);
        return;
      }
      const acquired = await port.acquire(route);
      if (disposed) { await port.release(acquired.leaseId); throw connectionError("LEASE_REVOKED"); }
      lease = acquired;
    },
    async validate(route) {
      if (!lease || disposed) throw connectionError("LEASE_REVOKED");
      const selection = parseModelRoute(route);
      if (selection.connectionId !== lease.configuration.connectionId) throw connectionError("NEW_SESSION_REQUIRED");
      if (!lease.configuration.models.some((model) => model.id === selection.modelId)) throw connectionError("MODEL_UNAVAILABLE");
      await port.validate(lease.leaseId, route);
    },
    createClient(options) {
      if (readOnly && !disposed) return new PiRpcClient({ ...options, env: {
        ...stripPuppyOneProviderCredentials(options.env), PUPPYONE_MODEL_CONNECTION_READ_ONLY: "1", PI_OFFLINE: "1",
      } });
      if (!lease || disposed) throw connectionError("AUTHORITY_REQUIRED");
      return new PiRpcClient({ ...options, spawn: spawnWithModelConfiguration(lease.configuration, options.spawn),
        sensitiveValues: lease.configuration.apiKey ? [lease.configuration.apiKey] : [] });
    },
    async dispose() {
      disposed = true;
      const previous = lease; lease = null;
      if (previous) await port.release(previous.leaseId);
    },
  };
}
