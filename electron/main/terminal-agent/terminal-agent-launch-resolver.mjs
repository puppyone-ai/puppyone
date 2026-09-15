import path from "node:path";
import {
  assertExecutableIdentity,
  createLocalAgentExecutableResolver,
} from "../local-agent-installation/executable-resolver.mjs";
import {
  createLocalAgentInstallationRegistry,
  defaultLocalAgentInstallationRegistry,
} from "../local-agent-installation/installation-registry.mjs";

const TERMINAL_AGENT_LAUNCHER_IDS = new Set(
  defaultLocalAgentInstallationRegistry.map(({ id }) => id),
);

/**
 * Authoritative launch-time resolver. Locator snapshots are advisory, so the
 * executable is resolved and identity-checked again for every process start.
 */
export function createTerminalAgentLaunchResolver(options = {}) {
  const {
    catalog = defaultLocalAgentInstallationRegistry,
    assertCandidate = (candidate) => assertExecutableIdentity(candidate),
  } = options;
  const definitions = createLocalAgentInstallationRegistry(catalog);
  const candidateResolver = options.candidateResolver ?? createLocalAgentExecutableResolver({
    registry: definitions,
    ...(options.discoveryPort ? { discoveryPort: options.discoveryPort } : {}),
  });
  const createResolutionContext = options.createResolutionContext
    ?? (options.resolveCandidate ? async () => Object.freeze({}) : () => candidateResolver.createContext());
  const resolveCandidate = options.resolveCandidate
    ?? (async (definition, context) => {
      const result = await candidateResolver.resolve(definition.id, { context });
      return result.status === "found" ? result.candidate : null;
    });
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));

  return async function resolveTerminalAgentLaunch(launcherId) {
    const definition = definitionsById.get(launcherId);
    if (!definition) throw terminalAgentUnavailableError();

    const resolutionContext = await Promise.resolve(createResolutionContext()).catch(() => null);
    if (!resolutionContext) throw terminalAgentUnavailableError();
    const candidate = await resolveCandidate(definition, resolutionContext).catch(() => null);
    if (!isSafeLaunchCandidate(candidate)) throw terminalAgentUnavailableError();
    const executablePath = await assertCandidate(candidate).catch(() => null);
    if (!isSafeAbsolutePath(executablePath)) throw terminalAgentUnavailableError();

    return Object.freeze({
      args: Object.freeze([...(candidate.argsPrefix ?? [])]),
      displayName: definition.displayName,
      executablePath,
      pathEntries: Object.freeze(candidate.launchPathEntry ? [candidate.launchPathEntry] : []),
    });
  };
}

export function isTerminalAgentLauncherId(value) {
  return typeof value === "string"
    && TERMINAL_AGENT_LAUNCHER_IDS.has(value);
}

function isSafeLaunchCandidate(candidate) {
  return isSafeAbsolutePath(candidate?.executablePath)
    && Array.isArray(candidate.argsPrefix ?? [])
    && (candidate.argsPrefix ?? []).length <= 4
    && (candidate.argsPrefix ?? []).every((argument) => (
      typeof argument === "string"
      && argument.length <= 160
      && !/[\r\n\0]/u.test(argument)
    ))
    && (
      candidate.launchPathEntry === undefined
      || isSafeAbsolutePath(candidate.launchPathEntry)
    );
}

function isSafeAbsolutePath(value) {
  return typeof value === "string"
    && path.isAbsolute(value)
    && value.length <= 4_096
    && !/[\r\n\0]/u.test(value);
}

function terminalAgentUnavailableError() {
  return new Error("TERMINAL_AGENT_UNAVAILABLE");
}

export const terminalAgentLauncherPolicy = Object.freeze({
  launcherIds: Object.freeze(defaultLocalAgentInstallationRegistry.map(({ id }) => id)),
});
