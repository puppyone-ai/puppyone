import { randomBytes } from "node:crypto";
import { attachNativeAgentSessionFeed } from "./native-agent-session-feed.mjs";

const DEFAULT_TIMEOUT_MS = 120_000;
const SAFE_TOKEN = /^PUPPYONE_SMOKE_[A-Z0-9_]{4,96}$/u;

/** Privacy-safe failure: never carries provider output, paths or raw diagnostics. */
export class NativeAgentRoundtripError extends Error {
  constructor(runtimeId, stage, code = "runtime") {
    super(`Native Agent round-trip failed for ${runtimeId} during ${stage}.`);
    this.name = "NativeAgentRoundtripError";
    this.runtimeId = runtimeId;
    this.stage = stage;
    this.code = code;
  }
}

/**
 * Exercises the product service boundary against one real or fake runtime.
 * Returned data is intentionally limited to runtime ID, status and check names.
 */
export async function runNativeAgentRoundtrip({
  service,
  sender,
  workspaceRoot,
  runtimeId,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  tokenFactory = randomToken,
}) {
  let stage = "create";
  let activeSessionId = null;
  let feed = null;
  try {
    const created = await service.createSession(sender, { runtimeId }, workspaceRoot);
    activeSessionId = requiredSessionId(created, runtimeId, stage);
    const providerSessionId = requiredProviderSessionId(created, runtimeId, stage);
    feed = await attachNativeAgentSessionFeed({ service, sender, sessionId: activeSessionId, workspaceRoot });

    stage = "first-answer";
    const firstToken = requiredToken(tokenFactory(1), runtimeId, stage);
    const firstAnswer = await runTurn({
      service, sender, workspaceRoot, sessionId: activeSessionId, runtimeId, feed,
      token: firstToken, timeoutMs, stage,
    });
    if (!firstAnswer.includes(firstToken)) throw new NativeAgentRoundtripError(runtimeId, stage);

    stage = "close-before-resume";
    await feed.detach();
    feed = null;
    await service.closeSession(sender, {
      sessionId: activeSessionId,
      removePersistence: false,
    }, workspaceRoot);
    activeSessionId = null;

    stage = "locator";
    const listed = await service.listSessions(sender, {
      runtimeId,
      discoverNative: false,
      includeArchived: false,
    }, workspaceRoot);
    if (!listed?.sessions?.some((session) => (
      session?.id === created.session.id
      && session?.providerSessionId === providerSessionId
    ))) {
      throw new NativeAgentRoundtripError(runtimeId, stage);
    }

    stage = "resume";
    const resumed = await service.resumeSession(sender, {
      sessionId: created.session.id,
      runtimeId,
    }, workspaceRoot);
    activeSessionId = requiredSessionId(resumed, runtimeId, stage);
    if (
      activeSessionId !== created.session.id
      || requiredProviderSessionId(resumed, runtimeId, stage) !== providerSessionId
    ) {
      throw new NativeAgentRoundtripError(runtimeId, stage);
    }
    feed = await attachNativeAgentSessionFeed({ service, sender, sessionId: activeSessionId, workspaceRoot });

    stage = "follow-up";
    const followUpToken = requiredToken(tokenFactory(2), runtimeId, stage);
    const followUpAnswer = await runTurn({
      service, sender, workspaceRoot, sessionId: activeSessionId, runtimeId, feed,
      token: followUpToken, timeoutMs, stage,
    });
    if (!followUpAnswer.includes(followUpToken)) throw new NativeAgentRoundtripError(runtimeId, stage);

    stage = "close";
    await feed.detach();
    feed = null;
    await service.closeSession(sender, {
      sessionId: activeSessionId,
      removePersistence: false,
    }, workspaceRoot);
    activeSessionId = null;

    return {
      runtimeId,
      status: "passed",
      checks: ["create", "first-answer", "locator", "resume", "follow-up", "close"],
    };
  } catch (error) {
    if (error instanceof NativeAgentRoundtripError) throw error;
    throw new NativeAgentRoundtripError(runtimeId, stage, classifyFailure(error));
  } finally {
    await Promise.resolve(feed?.detach()).catch(() => {});
    if (activeSessionId) {
      await Promise.resolve(service.closeSession(sender, {
        sessionId: activeSessionId,
        removePersistence: false,
      }, workspaceRoot)).catch(() => {});
    }
  }
}

async function runTurn({
  service,
  sender,
  workspaceRoot,
  sessionId,
  runtimeId,
  token,
  timeoutMs,
  stage,
  feed,
}) {
  const waiter = feed.waitForTurn(timeoutMs);
  try {
    await service.startTurn(sender, {
      sessionId,
      prompt: `Reply with exactly ${token}. Do not use tools, inspect files, or add formatting.`,
    }, workspaceRoot);
    return await waiter.promise;
  } catch (error) {
    throw new NativeAgentRoundtripError(runtimeId, stage, classifyFailure(error));
  } finally {
    waiter.cancel();
  }
}

function requiredSessionId(snapshot, runtimeId, stage) {
  const value = snapshot?.session?.id;
  if (typeof value !== "string" || !/^[A-Za-z0-9:._-]{1,256}$/u.test(value)) {
    throw new NativeAgentRoundtripError(runtimeId, stage);
  }
  return value;
}

function requiredProviderSessionId(snapshot, runtimeId, stage) {
  const value = snapshot?.session?.providerSessionId;
  if (typeof value !== "string" || !/^[A-Za-z0-9:._-]{1,256}$/u.test(value)) {
    throw new NativeAgentRoundtripError(runtimeId, stage);
  }
  return value;
}

function requiredToken(value, runtimeId, stage) {
  if (typeof value !== "string" || !SAFE_TOKEN.test(value)) {
    throw new NativeAgentRoundtripError(runtimeId, stage);
  }
  return value;
}

function randomToken(index) {
  return `PUPPYONE_SMOKE_${index}_${randomBytes(12).toString("hex").toUpperCase()}`;
}

function classifyFailure(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/timed?\s*out|timeout/iu.test(message)) return "timeout";
  if (/auth|sign[ -]?in|login|credential|api[ _-]?key|account/iu.test(message)) return "authentication";
  if (/model|provider/iu.test(message)) return "model-unavailable";
  if (/enoent|spawn|executable|command not found|not installed/iu.test(message)) return "process-launch";
  if (/protocol|json-?rpc|initialize|handshake|parse error/iu.test(message)) return "protocol";
  if (/workspace|working directory|\bcwd\b|directory/iu.test(message)) return "workspace";
  if (/session|thread|conversation|rollout/iu.test(message)) return "session";
  return "runtime";
}
