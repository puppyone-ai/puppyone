import os from "node:os";
import { redactSecretText } from "../../agent-events.mjs";
import { readinessWithAccountState } from "../agent-input-policy.mjs";
import { publicRuntimeReadiness } from "../../runtime/agent-runtime-registry.mjs";
import { AgentRuntimeResolutionError } from "../../runtime/agent-runtime-resolution.mjs";
import { sanitizeAgentRuntimeDescriptor } from "../../../../../shared/agent-contract/runtime-schema.mjs";
import {
  assertAgentRuntimeInspection,
  normalizeCapabilitySnapshot,
} from "../../runtime/agent-runtime-port.mjs";
import { createAgentProcessSupervisor } from "../processes/agent-process-supervisor.mjs";
import { createRuntimeReadinessStore } from "./runtime-readiness-store.mjs";

const NEUTRAL_INSPECTION_ROOT = os.tmpdir();

export function createRuntimeResolutionCoordinator({
  runtimeRegistry,
  processSupervisor = createAgentProcessSupervisor(),
  readinessStore = createRuntimeReadinessStore(),
} = {}) {
  if (!runtimeRegistry || typeof runtimeRegistry.discover !== "function") {
    throw new TypeError("RuntimeResolutionCoordinator requires a runtime registry.");
  }
  const inspectionFlights = new Map();

  async function queryCatalog(request = {}, workspaceRoot = null) {
    validateRequestedRuntime(request.runtimeId, false);
    if (request.refresh) readinessStore.clear();
    const resolutionGeneration = readinessStore.generation();
    // A bound conversation must not wait for unrelated CLI installation/auth
    // probes. Only the unbound launcher/history query needs the full catalog.
    const catalog = await runtimeRegistry.discover({ refresh: Boolean(request.refresh), runtimeId: request.runtimeId });
    const selected = selectRequestedRuntime(catalog, request.runtimeId);
    const runtimes = catalog.map((entry) => ({
      descriptor: sanitizeAgentRuntimeDescriptor(entry.descriptor),
      readiness: publicRuntimeReadiness(entry),
    }));
    if (!selected) return emptyCatalog(runtimes);

    const publicReadiness = publicRuntimeReadiness(selected);
    const protocolFallback = allowsProtocolVerification(selected.readiness);
    if (publicReadiness.status !== "ready" && !protocolFallback) {
      return unavailableCatalog(runtimes, selected, publicReadiness);
    }

    const inspectionRoot = workspaceRoot || NEUTRAL_INSPECTION_ROOT;
    const cached = !request.refresh
      ? readinessStore.get(selected.descriptor.id, inspectionRoot)
      : null;
    if (cached) {
      updateRuntimeRow(runtimes, selected.descriptor.id, cached.publicReadiness);
      return catalogResult(runtimes, selected, cached.publicReadiness, cached.inspection);
    }

    try {
      const inspection = await inspectRuntimeSingleFlight(selected, inspectionRoot, resolutionGeneration);
      const effectiveReadiness = effectiveReadinessAfterInspection(selected, publicReadiness, inspection);
      if (readinessStore.generation() === resolutionGeneration) {
        readinessStore.set(selected.descriptor.id, inspectionRoot, {
          publicReadiness: effectiveReadiness,
          internalReadiness: promoteInternalReadiness(selected.readiness, effectiveReadiness),
          inspection,
          evidenceSource: "protocol-handshake",
        });
      }
      updateRuntimeRow(runtimes, selected.descriptor.id, effectiveReadiness);
      return catalogResult(runtimes, selected, effectiveReadiness, inspection);
    } catch (error) {
      const message = redactSecretText(error instanceof Error ? error.message : String(error));
      const failedReadiness = failedInspectionReadiness(publicReadiness, protocolFallback, message);
      readinessStore.invalidate(selected.descriptor.id, inspectionRoot);
      updateRuntimeRow(runtimes, selected.descriptor.id, failedReadiness);
      return {
        ...unavailableCatalog(runtimes, selected, failedReadiness),
        warnings: [message],
      };
    }
  }

  async function resolveForOperation({ runtimeId, workspaceRoot, operation, refresh = false }) {
    validateRequestedRuntime(runtimeId, true);
    if (refresh) readinessStore.clear();
    const catalog = await runtimeRegistry.discover({ refresh, runtimeId });
    const selected = selectRequestedRuntime(catalog, runtimeId, { required: true });
    const publicReadiness = publicRuntimeReadiness(selected);
    const protocolVerificationRequired = publicReadiness.status !== "ready"
      && allowsProtocolVerification(selected.readiness);
    if (publicReadiness.status !== "ready" && !protocolVerificationRequired) {
      throw new AgentRuntimeResolutionError({
        runtimeId: selected.descriptor.id,
        operation,
        readiness: publicReadiness,
      });
    }
    const cached = readinessStore.get(selected.descriptor.id, workspaceRoot);
    const effectivePublicReadiness = cached?.publicReadiness?.status === "ready"
      ? cached.publicReadiness
      : publicReadiness;
    return Object.freeze({
      descriptor: selected.descriptor,
      readiness: promoteInternalReadiness(selected.readiness, effectivePublicReadiness),
      publicReadiness: effectivePublicReadiness,
      protocolVerificationRequired,
      generation: readinessStore.generation(),
    });
  }

  function recordOperationSuccess({ runtimeId, workspaceRoot, readiness, descriptor, inspection }) {
    const publicBase = publicRuntimeReadiness({ descriptor, readiness });
    const effective = effectiveReadinessAfterInspection(
      { descriptor, readiness },
      publicBase,
      inspection,
    );
    return readinessStore.set(runtimeId, workspaceRoot, {
      publicReadiness: effective,
      internalReadiness: promoteInternalReadiness(readiness, effective),
      inspection,
      evidenceSource: "live-operation",
    });
  }

  function recordOperationFailure({ runtimeId, workspaceRoot }) {
    readinessStore.invalidate(runtimeId, workspaceRoot);
  }

  async function inspectRuntime(selected, workspaceRoot) {
    const adapter = runtimeRegistry.createAdapter(selected.descriptor.id, {
      readiness: selected.readiness,
      workspaceRoot,
      onEvent: () => {},
      onExit: () => {},
    });
    try {
      const inspected = await processSupervisor.runStart(
        { label: `${selected.descriptor.id}:catalog-inspect` },
        () => adapter.inspect(),
      );
      const inspection = assertAgentRuntimeInspection(adapter, inspected, selected.descriptor.id);
      return normalizeInspection(inspection, selected.descriptor);
    } finally {
      await adapter.dispose();
    }
  }

  function inspectRuntimeSingleFlight(selected, workspaceRoot, generation) {
    const key = `${generation}\0${selected.descriptor.id}\0${workspaceRoot}`;
    const existing = inspectionFlights.get(key);
    if (existing) return existing;
    const flight = inspectRuntime(selected, workspaceRoot).finally(() => {
      if (inspectionFlights.get(key) === flight) inspectionFlights.delete(key);
    });
    inspectionFlights.set(key, flight);
    return flight;
  }

  return {
    queryCatalog,
    resolveForOperation,
    recordOperationSuccess,
    recordOperationFailure,
    clear: () => {
      inspectionFlights.clear();
      return readinessStore.clear();
    },
  };
}

function selectRequestedRuntime(catalog, value, { required = false } = {}) {
  validateRequestedRuntime(value, required);
  if (value === undefined || value === null) {
    return null;
  }
  const selected = catalog.find((entry) => entry.descriptor.id === value) ?? null;
  if (!selected && required) throw new Error(`Agent runtime ${value} is not registered.`);
  return selected;
}

function validateRequestedRuntime(value, required) {
  if (value === undefined || value === null) {
    if (required) throw new Error("Choose an Agent before starting an Agent session.");
    return;
  }
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(value)) throw new Error("Agent runtime selection is invalid.");
}

function allowsProtocolVerification(readiness) {
  return readiness?.inspectionFallback === "runtime-handshake";
}

function effectiveReadinessAfterInspection(selected, publicReadiness, inspection) {
  const inspected = allowsProtocolVerification(selected.readiness)
    ? {
      ...publicReadiness,
      status: "ready",
      code: "READY",
      selectable: true,
      message: `${selected.descriptor.displayName} authentication was verified through its native protocol.`,
    }
    : publicReadiness;
  return readinessWithAccountState(inspected, inspection.account, selected.descriptor.displayName);
}

function promoteInternalReadiness(internalReadiness, publicReadiness) {
  if (publicReadiness.status !== "ready") return internalReadiness;
  return {
    ...internalReadiness,
    status: "ready",
    code: "READY",
    selectable: true,
    message: publicReadiness.message,
  };
}

function failedInspectionReadiness(publicReadiness, protocolFallback, message) {
  if (protocolFallback) {
    return {
      ...publicReadiness,
      selectable: false,
      diagnostic: [publicReadiness.diagnostic, `Native protocol fallback failed: ${message}`]
        .filter(Boolean)
        .join(" ")
        .slice(0, 4_000),
    };
  }
  return {
    ...publicReadiness,
    status: "error",
    code: "RUNTIME_INSPECTION_FAILED",
    selectable: false,
    message,
  };
}

function normalizeInspection(inspection, descriptor) {
  return {
    account: inspection.account ?? null,
    providers: Array.isArray(inspection.providers) ? inspection.providers : [],
    models: Array.isArray(inspection.models) ? inspection.models : [],
    modes: Array.isArray(inspection.modes) ? inspection.modes : [],
    commands: Array.isArray(inspection.commands) ? inspection.commands : [],
    capabilities: normalizeCapabilitySnapshot(inspection.capabilities),
    runtime: sanitizeAgentRuntimeDescriptor(inspection.runtime ?? descriptor),
    warnings: Array.isArray(inspection.warnings) ? inspection.warnings : [],
  };
}

function emptyCatalog(runtimes) {
  return {
    runtimes,
    selectedRuntimeId: null,
    readiness: null,
    account: null,
    providers: [],
    models: [],
    modes: [],
    commands: [],
    capabilities: null,
    warnings: [],
  };
}

function unavailableCatalog(runtimes, selected, readiness) {
  return {
    runtimes,
    selectedRuntimeId: selected.descriptor.id,
    readiness,
    account: null,
    providers: [],
    models: [],
    modes: [],
    commands: [],
    capabilities: null,
    runtime: { ...selected.descriptor },
    warnings: [],
  };
}

function catalogResult(runtimes, selected, readiness, inspection) {
  return {
    runtimes,
    selectedRuntimeId: selected.descriptor.id,
    readiness,
    ...inspection,
  };
}

function updateRuntimeRow(runtimes, runtimeId, readiness) {
  const entry = runtimes.find((candidate) => candidate.descriptor.id === runtimeId);
  if (entry) entry.readiness = readiness;
}
