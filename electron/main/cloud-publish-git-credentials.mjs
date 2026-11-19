import {
  GIT_MUTATION_TIMEOUT_MS,
  execGit,
} from "../local-api/git/runner.mjs";

const SNAPSHOT_VERSION = 1;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CONFIG_VALUES = 64;
const MAX_CONFIG_VALUE_BYTES = 4096;
const MAX_ENCODED_SNAPSHOT_LENGTH = 64 * 1024;

/**
 * Keeps raw credentials in main and installs a URL-scoped secure helper.
 * The scoped reset prevents inherited/unknown helpers from seeing PuppyOne
 * secrets without changing credential behavior for any other remote.
 */
export function createCloudPublishGitCredentialManager({
  execGitCommand = execGit,
  platform = process.platform,
} = {}) {
  async function prepare(rootPath, remoteUrl, operationId) {
    const scope = credentialScope(remoteUrl);
    requireOperationId(operationId);
    const current = await readScopedConfig(rootPath, scope, execGitCommand);
    if (current.markers.length > 0 || current.snapshots.length > 0) {
      throw credentialConfigConflict("A managed PuppyOne credential scope already exists for this URL.");
    }
    const helper = await selectSecureHelper(rootPath, remoteUrl, execGitCommand, platform);
    return normalizeCredentialConfigSnapshot({
      version: SNAPSHOT_VERSION,
      scope_url: new URL(remoteUrl).toString(),
      helper,
      previous_helpers: current.helpers,
      previous_use_http_path: current.useHttpPath,
    });
  }

  async function approve(rootPath, remoteUrl, username, secret, operationId, snapshotValue) {
    const snapshot = validateSnapshotForRemote(snapshotValue, remoteUrl);
    requireOperationId(operationId);
    let approved = false;
    try {
      await installManagedConfig(rootPath, snapshot, operationId, execGitCommand);
      await execGitCommand(rootPath, secureCredentialCommandArgs(
        remoteUrl,
        snapshot,
        ["credential", "approve"],
      ), {
        timeout: GIT_MUTATION_TIMEOUT_MS,
        input: credentialInput(remoteUrl, username, secret),
      });
      approved = true;
      await assertCredentialRoundTrip(
        rootPath,
        remoteUrl,
        username,
        secret,
        snapshot,
        execGitCommand,
      );
      return {
        async rollback() {
          if (approved) {
            await rejectCredential(rootPath, remoteUrl, username, snapshot, execGitCommand)
              .catch(() => undefined);
          }
          await restoreManagedConfig(rootPath, snapshot, operationId, execGitCommand);
        },
      };
    } catch (error) {
      if (approved) {
        await rejectCredential(rootPath, remoteUrl, username, snapshot, execGitCommand)
          .catch(() => undefined);
      }
      await restoreManagedConfig(rootPath, snapshot, operationId, execGitCommand).catch(() => undefined);
      throw error;
    }
  }

  async function cleanupManaged(rootPath, remoteUrl, username, operationId, snapshotValue) {
    const snapshot = validateSnapshotForRemote(snapshotValue, remoteUrl);
    requireOperationId(operationId);
    const scope = credentialScope(remoteUrl);
    const current = await readScopedConfig(rootPath, scope, execGitCommand);
    if (sameScopedConfig(current, previousConfig(snapshot))) return;
    assertRecoverableManagedConfig(current, snapshot, operationId);
    await rejectCredential(rootPath, remoteUrl, username, snapshot, execGitCommand);
    await restoreManagedConfig(rootPath, snapshot, operationId, execGitCommand);
  }

  async function assertManaged(rootPath, remoteUrl, operationId, snapshotValue) {
    const snapshot = validateSnapshotForRemote(snapshotValue, remoteUrl);
    requireOperationId(operationId);
    const current = await readScopedConfig(rootPath, credentialScope(remoteUrl), execGitCommand);
    const expected = {
      helpers: ["", snapshot.helper],
      useHttpPath: ["true"],
      markers: [operationId],
      snapshots: [encodeSnapshot(snapshot)],
    };
    if (!sameScopedConfig(current, expected)) {
      throw credentialConfigConflict(
        "Managed PuppyOne credential configuration changed during the Git operation.",
      );
    }
  }

  /** Exact local Detach cleanup using the durable URL-scoped snapshot marker. */
  async function detachManaged(rootPath, remoteUrl, username = "x-puppyone-token") {
    const scope = credentialScope(remoteUrl);
    const current = await readScopedConfig(rootPath, scope, execGitCommand);
    if (current.markers.length === 0 && current.snapshots.length === 0) {
      return { managed: false };
    }
    if (current.markers.length !== 1 || current.snapshots.length !== 1) {
      throw credentialConfigConflict("Managed PuppyOne credential metadata is ambiguous.");
    }
    const operationId = requireOperationId(current.markers[0]);
    const snapshot = decodeSnapshot(current.snapshots[0]);
    validateSnapshotForRemote(snapshot, remoteUrl);
    assertRecoverableManagedConfig(current, snapshot, operationId);
    await rejectCredential(rootPath, remoteUrl, username, snapshot, execGitCommand);
    await restoreManagedConfig(rootPath, snapshot, operationId, execGitCommand);
    return { managed: true };
  }

  return {
    approve,
    assertManaged,
    cleanupManaged,
    commandArgs: secureCredentialCommandArgs,
    detachManaged,
    prepare,
  };
}

async function assertCredentialRoundTrip(
  rootPath,
  remoteUrl,
  username,
  expectedSecret,
  snapshot,
  execGitCommand,
) {
  let stdout;
  try {
    ({ stdout } = await execGitCommand(rootPath, secureCredentialCommandArgs(
      remoteUrl,
      snapshot,
      ["credential", "fill"],
    ), {
      timeout: GIT_MUTATION_TIMEOUT_MS,
      input: credentialInput(remoteUrl, username),
    }));
  } catch (error) {
    throw credentialRoundTripFailure(safeCredentialHelperDiagnostic(error), error);
  }

  const returned = parseCredentialOutput(stdout);
  if (returned.username !== username || returned.password !== expectedSecret) {
    throw credentialRoundTripFailure("The secure Git credential helper did not return the stored credential.");
  }
}

function parseCredentialOutput(value) {
  const fields = {};
  for (const line of String(value || "").split(/\r?\n/)) {
    if (!line) break;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    fields[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return fields;
}

function safeCredentialHelperDiagnostic(error) {
  const source = [error?.stderr, error?.message]
    .find((value) => typeof value === "string" && value.trim());
  if (!source) return "The secure Git credential helper could not retrieve the stored credential.";
  return String(source)
    .replace(/pwg_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function credentialRoundTripFailure(diagnostic, cause = undefined) {
  const error = new Error(
    `The secure Git credential helper failed its store/read verification. ${diagnostic}`,
    cause ? { cause } : undefined,
  );
  error.code = "PUPPYONE_CREDENTIAL_ROUNDTRIP_FAILED";
  return error;
}

async function installManagedConfig(rootPath, snapshot, operationId, execGitCommand) {
  const scope = credentialScope(snapshot.scope_url);
  const current = await readScopedConfig(rootPath, scope, execGitCommand);
  assertRecoverableManagedConfig(current, snapshot, operationId, { allowPrevious: true });
  const encoded = encodeSnapshot(snapshot);
  // Metadata is written first. If Desktop crashes between writes, the durable
  // journal plus this marker can recognize and finish the exact configuration.
  await replaceLocalConfigValues(rootPath, execGitCommand, scope.snapshotKey, [encoded]);
  await replaceLocalConfigValues(rootPath, execGitCommand, scope.markerKey, [operationId]);
  await replaceLocalConfigValues(rootPath, execGitCommand, scope.useHttpPathKey, ["true"]);
  await replaceLocalConfigValues(rootPath, execGitCommand, scope.helperKey, ["", snapshot.helper]);
}

async function restoreManagedConfig(rootPath, snapshot, operationId, execGitCommand) {
  const scope = credentialScope(snapshot.scope_url);
  const current = await readScopedConfig(rootPath, scope, execGitCommand);
  if (sameScopedConfig(current, previousConfig(snapshot))) return;
  assertRecoverableManagedConfig(current, snapshot, operationId);
  // Ownership metadata remains until the original values are fully restored,
  // making cleanup resumable across a crash at every individual config write.
  await replaceLocalConfigValues(rootPath, execGitCommand, scope.helperKey, snapshot.previous_helpers);
  await replaceLocalConfigValues(rootPath, execGitCommand, scope.useHttpPathKey, snapshot.previous_use_http_path);
  await replaceLocalConfigValues(rootPath, execGitCommand, scope.markerKey, []);
  await replaceLocalConfigValues(rootPath, execGitCommand, scope.snapshotKey, []);
}

function assertRecoverableManagedConfig(current, snapshot, operationId, { allowPrevious = false } = {}) {
  const previous = previousConfig(snapshot);
  if (allowPrevious && sameScopedConfig(current, previous)) return;
  const encoded = encodeSnapshot(snapshot);
  const helperExpected = ["", snapshot.helper];
  const eachRecoverable = (
    // replaceLocalConfigValues is a sequence of unset + add operations. A
    // crash can therefore leave any prefix of the owned source/destination
    // values. Exact durable ownership metadata lets us safely complete that
    // deterministic transition on resume without accepting arbitrary values.
    prefixOfOne(current.helpers, previous.helpers, helperExpected)
    && prefixOfOne(current.useHttpPath, previous.useHttpPath, ["true"])
    && oneOf(current.markers, [], [operationId])
    && oneOf(current.snapshots, [], [encoded])
  );
  const ownershipPresent = (
    arraysEqual(current.markers, [operationId])
    || arraysEqual(current.snapshots, [encoded])
  );
  if (!eachRecoverable || !ownershipPresent) {
    throw credentialConfigConflict(
      "PuppyOne credential configuration changed outside the pending operation.",
    );
  }
}

function previousConfig(snapshot) {
  return {
    helpers: snapshot.previous_helpers,
    useHttpPath: snapshot.previous_use_http_path,
    markers: [],
    snapshots: [],
  };
}

async function readScopedConfig(rootPath, scope, execGitCommand) {
  const [helpers, useHttpPath, markers, snapshots] = await Promise.all([
    readConfigValues(rootPath, execGitCommand, ["--local", "--get-all", scope.helperKey]),
    readConfigValues(rootPath, execGitCommand, ["--local", "--get-all", scope.useHttpPathKey]),
    readConfigValues(rootPath, execGitCommand, ["--local", "--get-all", scope.markerKey]),
    readConfigValues(rootPath, execGitCommand, ["--local", "--get-all", scope.snapshotKey]),
  ]);
  return { helpers, useHttpPath, markers, snapshots };
}

async function selectSecureHelper(rootPath, remoteUrl, execGitCommand, platform) {
  const [general, matched] = await Promise.all([
    readConfigValues(rootPath, execGitCommand, ["--get-all", "credential.helper"]),
    readConfigValues(rootPath, execGitCommand, ["--get-urlmatch", "credential.helper", remoteUrl]),
  ]);
  const configured = [...matched, ...general].find(isKnownSecureCredentialHelper) ?? null;
  const platformDefault = platform === "darwin"
    ? "osxkeychain"
    : platform === "win32"
      ? "manager"
      : null;
  const helper = configured ?? platformDefault;
  if (!helper) {
    const error = new Error(
      "No secure Git credential helper is configured. Install Git Credential Manager or libsecret.",
    );
    error.code = "SECURE_GIT_CREDENTIAL_HELPER_REQUIRED";
    throw error;
  }
  return helper.trim().toLowerCase();
}

async function rejectCredential(rootPath, remoteUrl, username, snapshot, execGitCommand) {
  await execGitCommand(rootPath, secureCredentialCommandArgs(
    remoteUrl,
    snapshot,
    ["credential", "reject"],
  ), {
    timeout: GIT_MUTATION_TIMEOUT_MS,
    input: credentialInput(remoteUrl, username),
  });
}

export function secureCredentialCommandArgs(remoteUrl, snapshotValue, args) {
  const snapshot = validateSnapshotForRemote(snapshotValue, remoteUrl);
  if (!Array.isArray(args) || args.some((entry) => typeof entry !== "string")) {
    throw credentialConfigConflict("Git credential command is invalid.");
  }
  const scope = credentialScope(remoteUrl);
  // Command scope has higher precedence than a concurrently-mutated local
  // config. The empty helper resets the complete inherited helper chain.
  return [
    "-c", `${scope.helperKey}=`,
    "-c", `${scope.helperKey}=${snapshot.helper}`,
    "-c", `${scope.useHttpPathKey}=true`,
    ...args,
  ];
}

async function readConfigValues(rootPath, execGitCommand, args) {
  return execGitCommand(rootPath, ["config", ...args], { optionalLocks: false })
    .then(({ stdout }) => splitConfigValues(stdout))
    .catch((error) => {
      if (Number(error?.code) === 1) return [];
      throw error;
    });
}

function splitConfigValues(stdout) {
  const values = String(stdout).split(/\r?\n/);
  if (values.at(-1) === "") values.pop();
  return values;
}

async function replaceLocalConfigValues(rootPath, execGitCommand, key, values) {
  await execGitCommand(rootPath, ["config", "--local", "--unset-all", key], {
    timeout: GIT_MUTATION_TIMEOUT_MS,
  }).catch((error) => {
    if (Number(error?.code) !== 5 && Number(error?.code) !== 1) throw error;
  });
  for (const value of values) {
    await execGitCommand(rootPath, ["config", "--local", "--add", key, value], {
      timeout: GIT_MUTATION_TIMEOUT_MS,
    });
  }
}

function credentialScope(remoteUrl) {
  const url = new URL(remoteUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw credentialConfigConflict("PuppyOne Git credential URL is invalid.");
  }
  const prefix = `credential.${url.toString()}`;
  return {
    helperKey: `${prefix}.helper`,
    markerKey: `${prefix}.puppyonemanaged`,
    snapshotKey: `${prefix}.puppyonesnapshot`,
    useHttpPathKey: `${prefix}.useHttpPath`,
  };
}

export function normalizeCredentialConfigSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== SNAPSHOT_VERSION) {
    throw credentialConfigConflict("PuppyOne credential snapshot is invalid.");
  }
  const scopeUrl = new URL(value.scope_url).toString();
  credentialScope(scopeUrl);
  if (!isKnownSecureCredentialHelper(value.helper)) {
    throw credentialConfigConflict("PuppyOne credential helper is not allowlisted.");
  }
  const normalized = {
    version: SNAPSHOT_VERSION,
    scope_url: scopeUrl,
    helper: value.helper.trim().toLowerCase(),
    previous_helpers: normalizeStringArray(value.previous_helpers, "previous_helpers"),
    previous_use_http_path: normalizeStringArray(value.previous_use_http_path, "previous_use_http_path"),
  };
  const encodedLength = Buffer.from(JSON.stringify(normalized)).toString("base64url").length;
  if (encodedLength > MAX_ENCODED_SNAPSHOT_LENGTH) {
    throw credentialConfigConflict("PuppyOne credential snapshot exceeds the durable metadata limit.");
  }
  return normalized;
}

function validateSnapshotForRemote(value, remoteUrl) {
  const snapshot = normalizeCredentialConfigSnapshot(value);
  if (snapshot.scope_url !== new URL(remoteUrl).toString()) {
    throw credentialConfigConflict("PuppyOne credential snapshot does not match the canonical remote.");
  }
  return snapshot;
}

function normalizeStringArray(value, field) {
  if (!Array.isArray(value) || value.length > MAX_CONFIG_VALUES) {
    throw credentialConfigConflict(`PuppyOne credential snapshot ${field} is invalid.`);
  }
  return value.map((entry) => {
    if (typeof entry !== "string" || Buffer.byteLength(entry) > MAX_CONFIG_VALUE_BYTES) {
      throw credentialConfigConflict(`PuppyOne credential snapshot ${field} is invalid.`);
    }
    return entry;
  });
}

function encodeSnapshot(snapshot) {
  return Buffer.from(JSON.stringify(normalizeCredentialConfigSnapshot(snapshot))).toString("base64url");
}

function decodeSnapshot(encoded) {
  try {
    if (
      typeof encoded !== "string"
      || encoded.length > MAX_ENCODED_SNAPSHOT_LENGTH
      || !/^[A-Za-z0-9_-]+$/.test(encoded)
    ) {
      throw new Error("invalid encoding");
    }
    return normalizeCredentialConfigSnapshot(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
  } catch (error) {
    throw credentialConfigConflict("Managed PuppyOne credential snapshot is corrupt.", error);
  }
}

function requireOperationId(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!UUID_V4.test(normalized)) throw credentialConfigConflict("PuppyOne credential operation id is invalid.");
  return normalized;
}

export function isKnownSecureCredentialHelper(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  // `!` values are shell commands and paths are arbitrary executables.
  return /^(?:osxkeychain|manager|manager-core|git-credential-manager|git-credential-manager-core|libsecret|secretservice|pass)$/.test(normalized);
}

function oneOf(value, ...candidates) {
  return candidates.some((candidate) => arraysEqual(value, candidate));
}

function prefixOfOne(value, ...candidates) {
  return candidates.some((candidate) => (
    value.length <= candidate.length
    && value.every((entry, index) => entry === candidate[index])
  ));
}

function sameScopedConfig(left, right) {
  return (
    arraysEqual(left.helpers, right.helpers)
    && arraysEqual(left.useHttpPath, right.useHttpPath)
    && arraysEqual(left.markers, right.markers)
    && arraysEqual(left.snapshots, right.snapshots)
  );
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function credentialConfigConflict(message, cause = undefined) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = "PUPPYONE_CREDENTIAL_CONFIG_CONFLICT";
  return error;
}

function credentialInput(remoteUrl, username, password = null) {
  const url = new URL(remoteUrl);
  const fields = [
    `protocol=${url.protocol.slice(0, -1)}`,
    `host=${url.host}`,
    `path=${url.pathname.replace(/^\//, "")}`,
    `username=${username}`,
  ];
  if (password !== null) fields.push(`password=${password}`);
  return `${fields.join("\n")}\n\n`;
}
