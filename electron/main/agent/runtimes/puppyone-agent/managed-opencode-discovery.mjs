import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn as nodeSpawn } from "node:child_process";
import { redactSecretText } from "../../agent-events.mjs";
import { createCachedRuntimeDiscovery } from "../../connections/runtime-discovery-cache.mjs";
import { compareVersions, discoverExecutable, runBounded } from "../../transports/executable-discovery.mjs";
import { PUPPYONE_AGENT_RUNTIME_ID } from "./puppyone-agent-identity.mjs";
import { OPENCODE_RELEASE_ARTIFACTS, OPENCODE_UPSTREAM } from "../opencode-protocol/opencode-manifest.mjs";
import { OPEN_CODE_LOCKED_ENVIRONMENT } from "../opencode-protocol/opencode-security-policy.mjs";
import { parseOpenCodeVersion } from "../opencode-protocol/opencode-version.mjs";

export function createOpenCodeDiscovery(options = {}) {
  const { cache: cacheOptions, ...discoveryOptions } = options;
  return createCachedRuntimeDiscovery(
    ({ signal }) => discoverOpenCodeExecutable({ ...discoveryOptions, signal }),
    cacheOptions,
  );
}

export async function discoverOpenCodeExecutable({
  signal,
  fsModule = fs,
  spawn = nodeSpawn,
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  homedir = os.homedir(),
  resourcesPath = process.resourcesPath,
  appPath = null,
  managedConfigDir = null,
  allowExternal = false,
} = {}) {
  const executableName = platform === "win32" ? "opencode.exe" : "opencode";
  const packagedCandidates = [
    resourcesPath && path.join(resourcesPath, "opencode", "bin", executableName),
    resourcesPath && path.join(resourcesPath, "opencode", "bin", "previous", executableName),
    appPath && path.join(appPath, "vendor", "opencode", "bin", executableName),
    appPath && path.join(appPath, "vendor", "opencode", "bin", "previous", executableName),
    appPath && path.join(appPath, "vendor", "opencode", "bin", `${platform}-${arch}`, executableName),
  ].filter(Boolean).map((candidate) => path.resolve(candidate));
  const userInstallCandidate = path.join(homedir, ".opencode", "bin", executableName);
  const packagedCandidateSet = new Set(packagedCandidates);
  const packagedFailures = [];
  const verifiedPackagedPaths = new Set();
  const explicitCandidate = allowExternal && typeof env.PUPPYONE_OPENCODE_BIN === "string" && env.PUPPYONE_OPENCODE_BIN.trim()
    ? path.resolve(env.PUPPYONE_OPENCODE_BIN.trim())
    : null;
  const result = await discoverExecutable({
      signal,
    executableNames: allowExternal ? [executableName] : [],
    additionalCandidates: [
      explicitCandidate,
      ...packagedCandidates,
      ...(allowExternal ? [userInstallCandidate] : []),
    ],
    fsModule,
    spawn,
    env,
    platform,
    homedir,
    parseVersion: parseOpenCodeVersion,
    minimumVersion: OPENCODE_UPSTREAM.protocolFloor,
    label: "OpenCode",
    buildEnvironment: (baseEnv, loginEnv) => buildOpenCodeEnvironment(baseEnv, loginEnv, {
      managedConfigDir,
      homedir,
    }),
    validateCandidate: async ({ candidate, resolvedPath }) => {
      if (!packagedCandidateSet.has(candidate)) return true;
      try {
        const metadata = await fsModule.promises.lstat(candidate);
        if (metadata.isSymbolicLink()) throw new Error("bundled executable may not be a symlink");
        await verifyBundledOpenCodeRuntime({ executablePath: resolvedPath, fsModule, platform, arch });
        verifiedPackagedPaths.add(resolvedPath);
        return true;
      } catch (error) {
        packagedFailures.push(error instanceof Error ? error.message : String(error));
        return false;
      }
    },
    searchPath: allowExternal,
  });
  const resolved = result.executablePath ? path.resolve(result.executablePath) : null;
  const source = resolved && verifiedPackagedPaths.has(resolved)
    ? "bundled"
    : explicitCandidate && resolved === explicitCandidate
      ? "managed"
      : resolved
        ? "external"
        : "missing";
  let readiness = result;
  if (!readiness.executablePath && packagedFailures.length > 0) {
    readiness = {
      ...readiness,
      status: "error",
      code: "RUNTIME_DISCOVERY_FAILED",
      message: "The bundled OpenCode runtime failed integrity verification. PuppyOne will not execute it.",
      diagnostic: packagedFailures.join("; ").slice(0, 4_000),
    };
  }
  if (
    readiness.status === "ready"
    && source === "bundled"
    && readiness.version !== OPENCODE_UPSTREAM.sourceVersion
  ) {
    readiness = {
      ...readiness,
      status: "unsupported-version",
      code: "RUNTIME_VERSION_UNSUPPORTED",
      message: `The bundled OpenCode runtime is ${readiness.version}; PuppyOne expects ${OPENCODE_UPSTREAM.sourceVersion}.`,
    };
  }
  if (readiness.status === "ready" && readiness.executablePath) {
    try {
      const probe = await runBounded(spawn, readiness.executablePath, ["acp", "--help"], {
        env: readiness.environment,
        timeoutMs: 4_000,
        maxBytes: 64 * 1024,
        label: "PuppyOne Agent ACP",
      });
      if (probe.code !== 0) throw new Error(`${probe.stdout}\n${probe.stderr}`.trim() || "ACP command failed");
    } catch (error) {
      readiness = {
        ...readiness,
        status: "protocol-unavailable",
        code: "PROTOCOL_PROBE_FAILED",
        message: "PuppyOne's managed Agent engine does not expose its required ACP endpoint.",
        diagnostic: error instanceof Error ? error.message : String(error),
      };
    }
  }
  if (readiness.status === "not-installed" && packagedFailures.length === 0) {
    readiness = {
      ...readiness,
      message: "This PuppyOne build is missing its managed Agent engine. Update or reinstall PuppyOne, then retry.",
    };
  } else if (source === "bundled" && readiness.status !== "ready") {
    readiness = {
      ...readiness,
      message: "PuppyOne could not verify its managed Agent engine. Retry, or update PuppyOne if the problem continues.",
    };
  } else if (readiness.status === "unsupported-version" && source !== "bundled") {
    readiness = {
      ...readiness,
      message: "The configured Agent engine is incompatible with this PuppyOne build. Use PuppyOne's managed engine, then retry.",
    };
  }
  return {
    provider: PUPPYONE_AGENT_RUNTIME_ID,
    runtimeId: PUPPYONE_AGENT_RUNTIME_ID,
    source,
    pinnedVersion: OPENCODE_UPSTREAM.sourceVersion,
    upstreamCommit: OPENCODE_UPSTREAM.commit,
    ...readiness,
    message: redactSecretText(readiness.message),
    ...(readiness.diagnostic ? { diagnostic: redactSecretText(readiness.diagnostic) } : {}),
    compatibility: source === "bundled" && readiness.version === OPENCODE_UPSTREAM.sourceVersion && readiness.status === "ready"
      ? "pinned-acp-v1"
      : readiness.status === "ready"
        ? "compatible-external"
        : "unavailable",
  };
}

export { parseOpenCodeVersion } from "../opencode-protocol/opencode-version.mjs";

export function buildOpenCodeEnvironment(baseEnv, loginEnv, { managedConfigDir, homedir = os.homedir() } = {}) {
  const merged = { ...baseEnv, ...loginEnv };
  const allowed = {};
  const exact = new Set([
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TEMP", "TMP",
    "LANG", "TERM", "COLORTERM", "SSH_AUTH_SOCK", "SSL_CERT_FILE", "SSL_CERT_DIR",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
    "http_proxy", "https_proxy", "all_proxy", "no_proxy",
  ]);
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value !== "string") continue;
    if (key.startsWith("OPENCODE_") || key.startsWith("PUPPYONE_")) {
      if (key === "OPENCODE_API_KEY") allowed[key] = value;
      continue;
    }
    if (
      exact.has(key)
      || key.startsWith("LC_")
      || key.startsWith("XDG_")
      || /(?:_API_KEY|_ACCESS_TOKEN|_AUTH_TOKEN|_CREDENTIALS|_PROFILE)$/.test(key)
    ) {
      allowed[key] = value;
    }
  }
  allowed.TERM = "dumb";
  allowed.PUPPYONE_AGENT = "1";
  allowed.OPENCODE_CLIENT = "puppyone-desktop";
  const managedProfileDir = path.resolve(
    managedConfigDir || path.join(homedir, ".config", "puppyone", "opencode-harness"),
  );
  const managedProfileRoot = path.dirname(managedProfileDir);
  allowed.OPENCODE_CONFIG_DIR = managedProfileDir;
  // OPENCODE_CONFIG_DIR is additive upstream: the normal XDG config and
  // ~/.opencode directory are otherwise still scanned. Isolate those code- and
  // command-bearing surfaces while leaving the provider credential data path
  // under OpenCode's own ownership.
  allowed.OPENCODE_TEST_HOME = path.join(managedProfileRoot, "home");
  allowed.XDG_CONFIG_HOME = path.join(managedProfileRoot, "xdg-config");
  allowed.XDG_CACHE_HOME = path.join(managedProfileRoot, "cache");
  allowed.XDG_STATE_HOME = path.join(managedProfileRoot, "state");
  Object.assign(allowed, OPEN_CODE_LOCKED_ENVIRONMENT);
  delete allowed.DEBUG;
  delete allowed.PUPPYONE_OPENCODE_BIN;
  return allowed;
}

export function isPinnedOpenCodeRuntime(readiness) {
  return Boolean(
    readiness?.status === "ready"
    && readiness?.source === "bundled"
    && readiness?.version === OPENCODE_UPSTREAM.sourceVersion
    && compareVersions(readiness.version, OPENCODE_UPSTREAM.protocolFloor) >= 0,
  );
}

export async function verifyBundledOpenCodeRuntime({ executablePath, fsModule = fs, platform = process.platform, arch = process.arch }) {
  const expectedArtifact = OPENCODE_RELEASE_ARTIFACTS[`${platform}-${arch}`];
  if (!expectedArtifact) throw new Error(`unsupported packaged platform ${platform}-${arch}`);
  const metadataPath = path.join(path.dirname(executablePath), "verified-runtime.json");
  const metadataStat = await fsModule.promises.lstat(metadataPath);
  if (!metadataStat.isFile() || metadataStat.isSymbolicLink()) throw new Error("bundled verification metadata must be a regular file");
  const metadata = JSON.parse(await fsModule.promises.readFile(metadataPath, "utf8"));
  if (metadata?.schemaVersion !== 1
    || metadata.version !== OPENCODE_UPSTREAM.sourceVersion
    || metadata.platform !== platform
    || metadata.arch !== arch
    || metadata.archive !== expectedArtifact.archive
    || metadata.archiveSha256 !== expectedArtifact.archiveSha256
    || metadata.releaseCommit !== OPENCODE_UPSTREAM.releaseCommit
    || !/^[a-f0-9]{64}$/.test(metadata.executableSha256)) {
    throw new Error("bundled verification metadata does not match the pinned release");
  }
  const digest = await hashFile(executablePath, fsModule);
  if (digest !== metadata.executableSha256) throw new Error("bundled executable SHA-256 mismatch");
  return metadata;
}

async function hashFile(filename, fsModule) {
  const hash = crypto.createHash("sha256");
  const stream = (fsModule.createReadStream ?? fs.createReadStream).call(fsModule, filename);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}
