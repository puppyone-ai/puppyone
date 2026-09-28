import { execFile as nodeExecFile } from "node:child_process";
import path from "node:path";

const MAX_APPLICATION_NAMES = 8;
const MAX_REGISTRY_OUTPUT_BYTES = 64 * 1024;
const REGISTRY_QUERY_TIMEOUT_MS = 1_500;

/** Resolve Windows desktop applications from OS-owned registration instead of install-directory guesses. */
export function createWindowsRegisteredApplicationLocator({
  nodePlatform = process.platform,
  environment = process.env,
  execFile = nodeExecFile,
} = {}) {
  async function find(applicationNames, { signal } = {}) {
    if (nodePlatform !== "win32") return Object.freeze([]);
    const names = normalizeApplicationNames(applicationNames);
    if (names.length === 0) return Object.freeze([]);
    const registryExecutable = windowsRegistryExecutable(environment);
    const observations = [];
    const seen = new Set();

    for (const applicationName of names) {
      signal?.throwIfAborted();
      const values = await Promise.all(registrationKeys(applicationName).map((key) => (
        queryDefaultRegistryValue({
          execFile,
          registryExecutable,
          key,
          signal,
        })
      )));
      signal?.throwIfAborted();
      for (const value of values) {
        const executablePath = registeredExecutablePath(value, environment);
        if (!executablePath || path.win32.basename(executablePath).toLowerCase() !== applicationName.toLowerCase()) {
          continue;
        }
        const identity = executablePath.toLowerCase();
        if (seen.has(identity)) continue;
        seen.add(identity);
        observations.push(Object.freeze({
          applicationName,
          executablePath,
          source: "windows-application-registration",
        }));
      }
    }
    return Object.freeze(observations);
  }

  return Object.freeze({ find, nodePlatform });
}

function registrationKeys(applicationName) {
  return [
    `HKCU\\Software\\Classes\\Applications\\${applicationName}\\shell\\open\\command`,
    `HKLM\\Software\\Classes\\Applications\\${applicationName}\\shell\\open\\command`,
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${applicationName}`,
    `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${applicationName}`,
  ];
}

function queryDefaultRegistryValue({ execFile, registryExecutable, key, signal }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      execFile(registryExecutable, ["query", key, "/ve"], {
        encoding: "buffer",
        windowsHide: true,
        timeout: REGISTRY_QUERY_TIMEOUT_MS,
        maxBuffer: MAX_REGISTRY_OUTPUT_BYTES,
        signal,
      }, (error, stdout) => {
        if (error) return finish(null);
        finish(parseWindowsRegistryDefaultValue(stdout));
      });
    } catch {
      finish(null);
    }
  });
}

/** Parse the default REG_SZ/REG_EXPAND_SZ row without depending on the localized value label. */
export function parseWindowsRegistryDefaultValue(output) {
  const text = decodeWindowsCommandOutput(output);
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/\sREG_(?:EXPAND_)?SZ\s+(.+)$/u);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

export function registeredExecutablePath(value, environment = process.env) {
  if (typeof value !== "string" || /[\r\n\0]/u.test(value)) return null;
  const expanded = expandWindowsEnvironment(value.trim(), environment);
  const quoted = expanded.match(/^"([^"]+\.exe)"(?:\s|$)/iu);
  const unquoted = expanded.match(/^(.+?\.exe)(?:\s|$)/iu);
  const executablePath = (quoted?.[1] ?? unquoted?.[1] ?? "").trim();
  return executablePath.length <= 4_096 && path.win32.isAbsolute(executablePath)
    ? executablePath
    : null;
}

function expandWindowsEnvironment(value, environment) {
  const entries = new Map(Object.entries(environment ?? {}).map(([key, entry]) => [
    key.toLowerCase(),
    typeof entry === "string" ? entry : "",
  ]));
  return value.replace(/%([^%]+)%/gu, (match, name) => entries.get(name.toLowerCase()) || match);
}

function normalizeApplicationNames(values) {
  return (Array.isArray(values) ? values : [])
    .slice(0, MAX_APPLICATION_NAMES)
    .filter((value) => typeof value === "string"
      && /^[A-Za-z0-9 ._-]+\.exe$/u.test(value)
      && value.length <= 120);
}

function windowsRegistryExecutable(environment) {
  const windowsRoot = environment?.SystemRoot || environment?.SYSTEMROOT || environment?.WINDIR || "C:\\Windows";
  return path.win32.join(windowsRoot, "System32", "reg.exe");
}

function decodeWindowsCommandOutput(output) {
  if (typeof output === "string") return output;
  if (!Buffer.isBuffer(output)) return "";
  const looksUtf16 = output[0] === 0xff && output[1] === 0xfe
    || output.subarray(0, Math.min(output.length, 80)).filter((byte, index) => index % 2 === 1 && byte === 0).length > 12;
  if (looksUtf16) return output.toString("utf16le").replace(/^\uFEFF/u, "");
  const utf8 = output.toString("utf8");
  if (!utf8.includes("\uFFFD")) return utf8;
  try {
    return new TextDecoder("gbk").decode(output);
  } catch {
    return utf8;
  }
}

export const windowsRegisteredApplicationLimits = Object.freeze({
  maxApplicationNames: MAX_APPLICATION_NAMES,
  maxRegistryOutputBytes: MAX_REGISTRY_OUTPUT_BYTES,
  registryQueryTimeoutMs: REGISTRY_QUERY_TIMEOUT_MS,
});
