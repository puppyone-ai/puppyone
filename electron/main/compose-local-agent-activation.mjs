import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { createLocalAgentExecutableResolver, assertExecutableIdentity } from "./local-agent-installation/executable-resolver.mjs";
import { createCodexActivationPort } from "./agent/runtimes/codex/codex-activation-port.mjs";
import { createCursorActivationPort } from "./agent/runtimes/cursor/cursor-activation-port.mjs";
import { createLocalAgentActivationService } from "./local-agent-activation/activation-service.mjs";
import { createActivationRegistry } from "./local-agent-activation/activation-registry.mjs";
import { createActivationJournal } from "./local-agent-activation/activation-journal.mjs";
import { createManagedArtifactInstaller } from "./local-agent-activation/managed-artifact-installer.mjs";
import { activationEnvironment, runActivationProcess } from "./local-agent-activation/activation-process.mjs";
import { ActivationError } from "./local-agent-activation/activation-error.mjs";

export function composeLocalAgentActivation({ app, discoveryPort, installationService, fetch, openExternal, publish }) {
  const homedir = os.homedir();
  const resolver = createLocalAgentExecutableResolver({ discoveryPort });
  return createLocalAgentActivationService({
    registry: createActivationRegistry({ ports: { codex: createCodexActivationPort(), cursor: createCursorActivationPort() } }),
    installer: createManagedArtifactInstaller({ homedir, fetch }),
    journal: createActivationJournal(path.join(app.getPath("userData"), "local-agent-activation.json")),
    openExternal, publish,
    refreshInstallations: () => installationService.discover({ refresh: true }),
    async resolveInstallation(id, signal) {
      const context = await resolver.createContext({ signal });
      const result = await resolver.resolve(id, { context });
      signal.throwIfAborted();
      if (result.status === "failed") throw new ActivationError("installation-check");
      return result.status === "found" ? result.candidate : null;
    },
    async createContext({ candidate, file, signal, argsPrefix = [] }) {
      // A staged entrypoint has no discovery receipt yet; capture its canonical
      // identity before running the provider's version-only verification.
      candidate ??= { executablePath: file, canonicalIdentity: await fs.realpath(file), argsPrefix, environment: process.env };
      const env = activationEnvironment(candidate.environment ?? process.env);
      const assertIdentity = () => assertExecutableIdentity(candidate);
      return { candidate, env, signal, cwd: homedir, appVersion: app.getVersion(), assertIdentity,
        async run(args, options) {
          signal.throwIfAborted();
          const executable = await assertIdentity();
          signal.throwIfAborted();
          return runActivationProcess(executable, [...(candidate.argsPrefix ?? []), ...args], { ...options, signal, env, cwd: homedir });
        },
      };
    },
  });
}
