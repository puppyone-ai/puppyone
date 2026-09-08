import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const SCHEMA_VERSION = 2;
const LEGACY_SCHEMA_VERSION = 1;
const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/;
const PROJECT_IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_NORMALIZED_ICON_BYTES = 4 * 1024 * 1024;
const MAX_PROJECT_RECORDS = 512;

/**
 * Main-process-owned local-first Project appearance repository.
 *
 * Metadata and content-addressed image bytes live under Electron userData,
 * never in a user's Project or renderer storage. The index contains no source
 * file paths, so it is safe to use as the eventual cloud reconciliation input.
 */
export function createProjectAppearanceStore({
  userDataPath,
  now = () => new Date(),
} = {}) {
  if (typeof userDataPath !== "string" || !userDataPath.trim()) {
    throw new TypeError("userDataPath is required for the Project appearance store.");
  }

  const root = path.join(path.resolve(userDataPath), "project-appearance");
  const paths = Object.freeze({
    root,
    assets: path.join(root, "assets"),
    index: path.join(root, "index.json"),
    legacyIndex: path.join(root, "index.v1.json"),
  });
  let layoutPromise = null;
  let mutationQueue = Promise.resolve();

  async function ensureLayout() {
    if (!layoutPromise) {
      layoutPromise = initializeLayout().catch((error) => {
        layoutPromise = null;
        throw error;
      });
    }
    await layoutPromise;
  }

  async function initializeLayout() {
    await fsp.mkdir(paths.assets, { recursive: true, mode: 0o700 });
    await Promise.all([
      fsp.chmod(paths.root, 0o700).catch(() => undefined),
      fsp.chmod(paths.assets, 0o700).catch(() => undefined),
    ]);
    await initializeIndex(paths, now);
  }

  async function readState() {
    await ensureLayout();
    const raw = await fsp.readFile(paths.index, "utf8");
    return normalizeState(JSON.parse(raw));
  }

  function mutate(operation) {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.catch(() => undefined);
    return result;
  }

  async function setIcon(projectIdentity, normalizedPng) {
    const identity = requireProjectIdentity(projectIdentity);
    const bytes = requireNormalizedPng(normalizedPng);
    return mutate(async () => {
      const state = await readState();
      const assetId = createHash("sha256").update(bytes).digest("hex");
      const assetPath = resolveAssetPath(paths.assets, assetId);
      await writeFileAtomicIfMissing(assetPath, bytes);
      const updatedAt = now().toISOString();
      const projects = {
        ...state.projects,
        [identity]: {
          icon: {
            kind: "asset",
            assetId,
            mediaType: "image/png",
          },
          updatedAt,
        },
      };
      const nextState = normalizeState({
        ...state,
        revision: state.revision + 1,
        projects: trimProjectRecords(projects),
        updatedAt,
      });
      await writeJsonAtomic(paths.index, nextState);
      await removeUnreferencedAssets(paths.assets, nextState.projects);
      return toStoredAppearance(identity, nextState.projects[identity] ?? null);
    });
  }

  async function resetIcon(projectIdentity) {
    const identity = requireProjectIdentity(projectIdentity);
    return mutate(async () => {
      const state = await readState();
      if (!Object.hasOwn(state.projects, identity)) {
        return toStoredAppearance(identity, null);
      }
      const projects = { ...state.projects };
      delete projects[identity];
      const updatedAt = now().toISOString();
      const nextState = normalizeState({
        ...state,
        revision: state.revision + 1,
        projects,
        updatedAt,
      });
      await writeJsonAtomic(paths.index, nextState);
      await removeUnreferencedAssets(paths.assets, nextState.projects);
      return toStoredAppearance(identity, null);
    });
  }

  async function setEmoji(projectIdentity, emoji) {
    const identity = requireProjectIdentity(projectIdentity);
    const value = requireProjectEmoji(emoji);
    return mutate(async () => {
      const state = await readState();
      const updatedAt = now().toISOString();
      const projects = {
        ...state.projects,
        [identity]: {
          icon: { kind: "emoji", value },
          updatedAt,
        },
      };
      const nextState = normalizeState({
        ...state,
        revision: state.revision + 1,
        projects: trimProjectRecords(projects),
        updatedAt,
      });
      await writeJsonAtomic(paths.index, nextState);
      await removeUnreferencedAssets(paths.assets, nextState.projects);
      return toStoredAppearance(identity, nextState.projects[identity] ?? null);
    });
  }

  async function list(projectIdentities) {
    const identities = requireProjectIdentityList(projectIdentities);
    const state = await readState();
    return identities.map((identity) => (
      toStoredAppearance(identity, state.projects[identity] ?? null)
    ));
  }

  async function readAsset(assetId) {
    const normalizedAssetId = requireAssetId(assetId);
    await ensureLayout();
    const assetPath = resolveAssetPath(paths.assets, normalizedAssetId);
    const bytes = await fsp.readFile(assetPath);
    const actualAssetId = createHash("sha256").update(bytes).digest("hex");
    if (
      bytes.length > MAX_NORMALIZED_ICON_BYTES
      || !hasPngSignature(bytes)
      || actualAssetId !== normalizedAssetId
    ) {
      throw new Error("Stored Project icon is invalid.");
    }
    return bytes;
  }

  return Object.freeze({
    paths,
    ensureLayout,
    list,
    readAsset,
    resetIcon,
    setEmoji,
    setIcon,
  });
}

export function requireProjectIdentity(value) {
  if (typeof value !== "string" || !PROJECT_IDENTITY_PATTERN.test(value)) {
    throw new TypeError("Project appearance identity is invalid.");
  }
  return value;
}

export function requireAssetId(value) {
  if (typeof value !== "string" || !CONTENT_HASH_PATTERN.test(value)) {
    throw new TypeError("Project icon asset id is invalid.");
  }
  return value;
}

export function requireProjectEmoji(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 32) {
    throw new TypeError("Project emoji is invalid.");
  }
  const graphemes = Array.from(new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value));
  if (
    graphemes.length !== 1
    || graphemes[0]?.segment !== value
    || !/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(value)
    || /[\p{Cc}\s]/u.test(value)
  ) {
    throw new TypeError("Project emoji is invalid.");
  }
  return value;
}

function requireProjectIdentityList(value) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new TypeError("Project appearance identity list is invalid.");
  }
  return Array.from(new Set(value.map(requireProjectIdentity)));
}

function requireNormalizedPng(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value ?? []);
  if (
    bytes.length === 0
    || bytes.length > MAX_NORMALIZED_ICON_BYTES
    || !hasPngSignature(bytes)
  ) {
    throw new TypeError("Normalized Project icon must be a valid bounded PNG.");
  }
  return bytes;
}

function hasPngSignature(bytes) {
  return bytes.length >= PNG_SIGNATURE.length
    && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function createEmptyState(now) {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    projects: {},
    updatedAt: now().toISOString(),
  };
}

function normalizeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Project appearance index is corrupt.");
  }
  if (value.schemaVersion !== SCHEMA_VERSION && value.schemaVersion !== LEGACY_SCHEMA_VERSION) {
    throw new Error("Project appearance index version is unsupported.");
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new Error("Project appearance revision is invalid.");
  }
  if (!value.projects || typeof value.projects !== "object" || Array.isArray(value.projects)) {
    throw new Error("Project appearance records are invalid.");
  }
  const projects = {};
  for (const [identity, record] of Object.entries(value.projects)) {
    requireProjectIdentity(identity);
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error("Project appearance record is invalid.");
    }
    if (typeof record.updatedAt !== "string" || !record.updatedAt) {
      throw new Error("Project appearance timestamp is invalid.");
    }
    if (record.icon?.kind === "asset" && record.icon?.mediaType === "image/png") {
      projects[identity] = {
        icon: {
          kind: "asset",
          assetId: requireAssetId(record.icon.assetId),
          mediaType: "image/png",
        },
        updatedAt: record.updatedAt,
      };
    } else if (value.schemaVersion === SCHEMA_VERSION && record.icon?.kind === "emoji") {
      projects[identity] = {
        icon: { kind: "emoji", value: requireProjectEmoji(record.icon.value) },
        updatedAt: record.updatedAt,
      };
    } else {
      throw new Error("Project icon record is invalid.");
    }
  }
  if (Object.keys(projects).length > MAX_PROJECT_RECORDS) {
    throw new Error("Project appearance index exceeds its record limit.");
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: value.revision,
    projects,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

function trimProjectRecords(projects) {
  const entries = Object.entries(projects);
  if (entries.length <= MAX_PROJECT_RECORDS) return projects;
  entries.sort((left, right) => (
    Date.parse(right[1].updatedAt) - Date.parse(left[1].updatedAt)
  ));
  return Object.fromEntries(entries.slice(0, MAX_PROJECT_RECORDS));
}

function toStoredAppearance(projectIdentity, record) {
  return Object.freeze({
    projectIdentity,
    icon: record
      ? Object.freeze(record.icon.kind === "asset"
        ? {
            kind: "asset",
            assetId: record.icon.assetId,
            mediaType: "image/png",
            updatedAt: record.updatedAt,
          }
        : {
            kind: "emoji",
            value: record.icon.value,
            updatedAt: record.updatedAt,
          })
      : null,
  });
}

function resolveAssetPath(assetsPath, assetId) {
  const normalizedAssetId = requireAssetId(assetId);
  const resolvedAssetsPath = path.resolve(assetsPath);
  const assetPath = path.resolve(resolvedAssetsPath, `${normalizedAssetId}.png`);
  if (!assetPath.startsWith(`${resolvedAssetsPath}${path.sep}`)) {
    throw new Error("Project icon asset path escapes its store.");
  }
  return assetPath;
}

async function removeUnreferencedAssets(assetsPath, projects) {
  const referenced = new Set(Object.values(projects).flatMap((record) => (
    record.icon.kind === "asset" ? [record.icon.assetId] : []
  )));
  const entries = await fsp.readdir(assetsPath, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile()) return;
    const match = /^([a-f0-9]{64})\.png$/.exec(entry.name);
    if (!match || referenced.has(match[1])) return;
    await fsp.rm(path.join(assetsPath, entry.name), { force: true });
  }));
}

async function createJsonIfMissing(filePath, value) {
  try {
    const handle = await fsp.open(filePath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
}

async function initializeIndex(paths, now) {
  try {
    await fsp.access(paths.index, fs.constants.F_OK);
    return;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  try {
    const legacy = JSON.parse(await fsp.readFile(paths.legacyIndex, "utf8"));
    await writeJsonAtomic(paths.index, normalizeState(legacy));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await createJsonIfMissing(paths.index, createEmptyState(now));
  }
}

async function writeFileAtomicIfMissing(filePath, bytes) {
  try {
    const existing = await fsp.readFile(filePath);
    if (existing.equals(bytes)) return;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle = null;
  try {
    handle = await fsp.open(tempPath, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await fsp.rename(tempPath, filePath);
  } finally {
    await handle?.close().catch(() => undefined);
    await fsp.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

async function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle = null;
  try {
    handle = await fsp.open(tempPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fsp.rename(tempPath, filePath);
    const directoryHandle = await fsp.open(directory, fs.constants.O_RDONLY).catch(() => null);
    if (directoryHandle) {
      try {
        await directoryHandle.sync().catch(() => undefined);
      } finally {
        await directoryHandle.close();
      }
    }
  } finally {
    await handle?.close().catch(() => undefined);
    await fsp.rm(tempPath, { force: true }).catch(() => undefined);
  }
}
