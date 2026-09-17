#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createDefaultAgentRuntimeHost } from "../../../../electron/main/agent/bootstrap/create-agent-runtime-host.mjs";
import { createAgentService } from "../../../../electron/main/agent/application/agent-service.mjs";
import { createEphemeralAgentSessionCache } from "../../../../electron/main/agent/cache/ephemeral-agent-session-cache.mjs";
import { createAgentConversationCatalog } from "../../../../electron/main/agent/persistence/agent-conversation-catalog.mjs";
import { createAgentSessionRepository } from "../../../../electron/main/agent/persistence/agent-session-repository.mjs";
import {
  NativeAgentRoundtripError,
  runNativeAgentRoundtrip,
} from "../../../../scripts/native-agent-roundtrip-runner.mjs";
import {
  NATIVE_AGENT_RUNTIME_IDS,
  nativeAgentSmokeTimeout,
  requestedNativeAgentRuntimeIds,
  safeNativeAgentReadinessStatus,
} from "../../../support/agent/native-agent-smoke-runtime-selection.mjs";
const FORBIDDEN_CATALOG_KEYS = new Set([
  "events", "messages", "transcript", "prompt", "answer", "reasoning",
  "toolOutput", "commandOutput", "diff", "environment", "executablePath",
]);

class SmokeSender extends EventEmitter {
  constructor() {
    super();
    this.id = 1;
  }

  isDestroyed() { return false; }
  send(channel, payload) { this.emit(channel, payload); }
}

if (process.env.RUN_NATIVE_AGENT_SMOKE !== "1") {
  console.log("Skipped native Agent round-trip. Set RUN_NATIVE_AGENT_SMOKE=1 to run against installed Agents.");
} else {
  const selection = requestedNativeAgentRuntimeIds(process.argv.slice(2), process.env.PUPPYONE_NATIVE_AGENT_RUNTIMES);
  if (!selection.valid) {
    console.error("Invalid native Agent runtime selection. Use codex, claude, cursor, opencode-native, pi, workbuddy-china, workbuddy-international, hermes, or all.");
    process.exitCode = 2;
  } else {
    await main(selection).catch(() => {
      console.log("Native Agent round-trip smoke results:");
      console.log("FAIL smoke-runner: setup");
      process.exitCode = 1;
    });
  }
}

async function main(selection) {
  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-native-agent-smoke-"));
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  const userDataRoot = path.join(temporaryRoot, "user-data");
  const catalogPath = path.join(userDataRoot, "agent-runtime", "conversations.json");
  const timeoutMs = nativeAgentSmokeTimeout(process.env.PUPPYONE_NATIVE_AGENT_TIMEOUT_MS);
  const safeLogger = Object.freeze({ warn() {}, error() {}, info() {} });
  let service = null;
  const results = [];

  try {
    await fs.promises.mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
    const runtimeHost = createDefaultAgentRuntimeHost({
      appVersion: "native-roundtrip-smoke",
      logger: safeLogger,
    });
    const eventCache = createEphemeralAgentSessionCache({
      app: { getPath: () => userDataRoot },
      logger: safeLogger,
    });
    const conversationCatalog = createAgentConversationCatalog({ filePath: catalogPath, logger: safeLogger });
    const sessionRepository = createAgentSessionRepository({ eventCache, conversationCatalog });
    service = createAgentService({
      runtimeRegistry: runtimeHost,
      sessionCache: sessionRepository,
      logger: safeLogger,
    });
    const sender = new SmokeSender();
    const catalog = await runtimeHost.discover({ refresh: true });
    const runtimeIds = selection.runtimeIds ?? [...NATIVE_AGENT_RUNTIME_IDS];

    for (const runtimeId of runtimeIds) {
      const entry = catalog.find((candidate) => candidate.descriptor.id === runtimeId);
      if (!entry || entry.readiness.status !== "ready") {
        results.push({
          runtimeId,
          status: selection.explicit ? "failed" : "skipped",
          check: "readiness",
          reason: safeNativeAgentReadinessStatus(entry?.readiness?.status),
        });
        continue;
      }
      try {
        results.push(await runNativeAgentRoundtrip({
          service,
          sender,
          workspaceRoot,
          runtimeId,
          timeoutMs,
        }));
      } catch (error) {
        results.push({
          runtimeId,
          status: "failed",
          check: error instanceof NativeAgentRoundtripError ? error.stage : "unknown",
          code: error instanceof NativeAgentRoundtripError ? error.code : "runtime",
        });
      }
    }

    if (results.some((result) => result.status === "passed")) {
      try {
        await assertLocatorCatalogSafe(catalogPath);
      } catch {
        results.push({ runtimeId: "catalog", status: "failed", check: "privacy" });
      }
    }
  } catch {
    results.push({ runtimeId: "smoke-runner", status: "failed", check: "setup" });
  } finally {
    await Promise.resolve(service?.closeAll()).catch(() => {});
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
  }

  printResults(results);
  const passed = results.filter((result) => result.status === "passed");
  const failed = results.filter((result) => result.status === "failed");
  if (passed.length === 0 || failed.length > 0) process.exitCode = 1;
}

async function assertLocatorCatalogSafe(filePath) {
  const parsed = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_CATALOG_KEYS.has(key)) throw new Error("Unsafe locator catalog.");
      visit(child);
    }
  };
  visit(parsed);
}

function printResults(results) {
  console.log("Native Agent round-trip smoke results:");
  for (const result of results) {
    if (result.status === "passed") {
      console.log(`PASS ${result.runtimeId}: create, answer, locator, resume, follow-up, close`);
    } else if (result.status === "skipped") {
      console.log(`SKIP ${result.runtimeId}: ${result.reason}`);
    } else {
      console.log(`FAIL ${result.runtimeId}: ${result.check}/${result.code || "runtime"}`);
    }
  }
}
