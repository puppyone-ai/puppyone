import { assertAgentRuntimePort } from "./agent-runtime-port.mjs";
import { RuntimeDiscoverySupervisor } from "./runtime-discovery-supervisor.mjs";
import { sanitizeAgentRuntimeDescriptor } from "../../../../shared/agent-contract/runtime-schema.mjs";
import {
  defineAgentRuntimeManifest,
  runtimeDescriptorFromManifest,
} from "./agent-runtime-manifest.mjs";
import {
  assertAgentRuntimeReadiness,
} from "../../../../shared/agent-contract/schema.mjs";

export class AgentRuntimeRegistry {
  constructor(definitions, { defaultRuntimeId = null, discoveryTimeoutMs } = {}) {
    this.discoverySupervisor = new RuntimeDiscoverySupervisor({ timeoutMs: discoveryTimeoutMs });
    this.definitions = new Map();
    for (const candidate of definitions) {
      validateDefinition(candidate);
      const manifest = defineAgentRuntimeManifest(candidate.manifest);
      const descriptor = runtimeDescriptorFromManifest(manifest);
      const definition = Object.freeze({ ...candidate, manifest, descriptor });
      if (this.definitions.has(manifest.id)) {
        throw new Error(`Duplicate Agent runtime: ${manifest.id}`);
      }
      this.definitions.set(manifest.id, definition);
    }
    if (this.definitions.size === 0) throw new Error("At least one Agent runtime must be registered.");
    const defaultId = defaultRuntimeId ?? this.descriptors()[0]?.id ?? null;
    if (!this.definitions.has(defaultId)) throw new Error(`Default Agent runtime is not registered: ${defaultId}`);
    this.defaultRuntimeId = defaultId;
  }

  descriptors() {
    return Array.from(this.definitions.values())
      .map((definition) => sanitizeAgentRuntimeDescriptor(definition.descriptor))
      .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  }

  /** Main-process-only manifests. Renderer/API callers receive descriptors. */
  manifests() {
    return this.descriptors().map((descriptor) => this.require(descriptor.id).manifest);
  }

  async discover({ refresh = false, runtimeId = null } = {}) {
    const descriptors = this.descriptors().filter(descriptor => !runtimeId || descriptor.id === runtimeId);
    const results = await Promise.all(descriptors.map(async (descriptor) => {
      const definition = this.require(descriptor.id);
      try {
        const readiness = await this.discoverySupervisor.run(descriptor.id, async (signal) => {
          const result = await definition.discovery.discover({ refresh, signal });
          assertAgentRuntimeReadiness(result);
          const reportedId = result.runtimeId ?? result.provider;
          if (reportedId && reportedId !== descriptor.id) throw new Error("Discovery returned a different Agent runtime identity.");
          return result;
        });
        return { descriptor, readiness };
      } catch (error) {
        return {
          descriptor,
          readiness: {
            runtimeId: descriptor.id,
            provider: descriptor.id,
            status: "error",
            code: "RUNTIME_DISCOVERY_FAILED",
            version: null,
            minimumVersion: null,
            executablePath: null,
            environment: {},
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }));
    return results;
  }

  select(catalog, preferredRuntimeId = null) {
    const runtimeId = preferredRuntimeId || this.defaultRuntimeId;
    return catalog.find((entry) => entry.descriptor.id === runtimeId) ?? null;
  }

  createAdapter(runtimeId, options) {
    const definition = this.require(runtimeId);
    return assertAgentRuntimePort(definition.createAdapter(options), runtimeId);
  }

  require(runtimeId) {
    const definition = this.definitions.get(runtimeId);
    if (!definition) throw new Error(`Unknown Agent runtime: ${runtimeId}`);
    return definition;
  }

  async dispose() {
    this.discoverySupervisor.dispose();
    const results = await Promise.allSettled(Array.from(this.definitions.values()).map((definition) => definition.dispose?.()));
    const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (failures.length) throw new AggregateError(failures, "One or more Agent runtimes failed to dispose cleanly.");
  }

  hasActiveResources() {
    if (this.discoverySupervisor.hasActiveResources()) return true;
    for (const definition of this.definitions.values()) {
      try {
        if (definition.hasActiveResources?.() === true) return true;
      } catch {
        // A failed resource probe is treated as active so shutdown still runs.
        return true;
      }
    }
    return false;
  }
}

/** Main-process lifecycle facade. The renderer never receives this object. */
export class AgentRuntimeHost {
  constructor(registry) {
    if (!(registry instanceof AgentRuntimeRegistry)) throw new TypeError("AgentRuntimeHost requires an AgentRuntimeRegistry.");
    this.registry = registry;
  }

  descriptors() { return this.registry.descriptors(); }
  manifests() { return this.registry.manifests(); }
  discover(options) { return this.registry.discover(options); }
  select(catalog, runtimeId) { return this.registry.select(catalog, runtimeId); }
  createAdapter(runtimeId, options) { return this.registry.createAdapter(runtimeId, options); }
  require(runtimeId) { return this.registry.require(runtimeId); }
  hasActiveResources() { return this.registry.hasActiveResources(); }
  dispose() { return this.registry.dispose(); }
}

export function publicRuntimeReadiness(entry) {
  const readiness = entry?.readiness ?? {};
  const status = readiness.status ?? "error";
  const result = {
    runtimeId: entry?.descriptor?.id ?? readiness.runtimeId ?? readiness.provider ?? "unknown",
    provider: entry?.descriptor?.id ?? readiness.provider ?? "unknown",
    status,
    code: readiness.code ?? "RUNTIME_DISCOVERY_FAILED",
    version: readiness.version ?? null,
    minimumVersion: readiness.minimumVersion ?? null,
    message: readiness.message ?? "",
    source: readiness.source ?? "external",
    compatibility: readiness.compatibility ?? "unknown",
    selectable: status === "ready" && readiness.selectable !== false,
    ...(readiness.diagnostic ? { diagnostic: readiness.diagnostic } : {}),
  };
  return assertAgentRuntimeReadiness(result);
}

function validateDefinition(definition) {
  if (!definition?.manifest) throw new TypeError("Agent runtime definition requires a manifest.");
  if (Object.prototype.hasOwnProperty.call(definition, "descriptor")) {
    throw new TypeError("Agent runtime descriptors are derived from manifests and must not be registered separately.");
  }
  const manifest = defineAgentRuntimeManifest(definition.manifest);
  if (!definition.discovery || typeof definition.discovery.discover !== "function") {
    throw new TypeError(`Agent runtime ${manifest.id} requires discovery.`);
  }
  if (typeof definition.createAdapter !== "function") {
    throw new TypeError(`Agent runtime ${manifest.id} requires an adapter factory.`);
  }
}
