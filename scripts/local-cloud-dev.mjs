import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  resolveNpmInvocation,
  spawnManagedChild,
  terminateManagedChild,
} from "./managed-child-process.mjs";

const VITE_DEVELOPMENT_ENV_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
];

export function parseEnvText(source) {
  const values = {};
  if (typeof source !== "string") return values;

  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[match[1]] = value;
  }

  return values;
}

export function loadDesktopDevelopmentEnvironment({
  desktopRoot,
  environment = process.env,
  readFile = readFileSync,
} = {}) {
  if (typeof desktopRoot !== "string" || !desktopRoot.trim()) {
    throw new TypeError("Desktop root is required to load development environment variables.");
  }

  const loaded = {};
  for (const filename of VITE_DEVELOPMENT_ENV_FILES) {
    try {
      Object.assign(
        loaded,
        parseEnvText(readFile(path.join(desktopRoot, filename), "utf8")),
      );
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  return { ...loaded, ...environment };
}

export function resolveLocalCloudDevConfig({
  desktopRoot,
  environment = process.env,
  readFile = readFileSync,
} = {}) {
  const effectiveEnvironment = loadDesktopDevelopmentEnvironment({
    desktopRoot,
    environment,
    readFile,
  });
  const apiBaseValue = firstNonEmpty(
    effectiveEnvironment.VITE_DESKTOP_CLOUD_API_URL,
    effectiveEnvironment.VITE_CLOUD_API_URL,
    effectiveEnvironment.VITE_API_URL,
  );
  if (!apiBaseValue) return null;

  const apiBaseUrl = parseConfiguredHttpUrl(apiBaseValue, "Desktop Cloud API URL");
  if (!isLoopbackHostname(apiBaseUrl.hostname)) return null;

  const webUrl = parseConfiguredHttpUrl(
    effectiveEnvironment.VITE_DESKTOP_CLOUD_WEB_URL,
    "VITE_DESKTOP_CLOUD_WEB_URL",
  );
  if (!isLoopbackHostname(webUrl.hostname)) {
    throw new Error("Local Cloud web URL must use a loopback hostname.");
  }
  if (webUrl.pathname !== "/" || webUrl.search || webUrl.hash) {
    throw new Error("VITE_DESKTOP_CLOUD_WEB_URL must be an origin without a path, query, or hash.");
  }

  const cloudRootValue = firstNonEmpty(effectiveEnvironment.PUPPYONE_CLOUD_DEV_ROOT);
  if (!cloudRootValue) {
    throw new Error("PUPPYONE_CLOUD_DEV_ROOT must be configured for a local Cloud API.");
  }
  const cloudRoot = path.isAbsolute(cloudRootValue)
    ? path.normalize(cloudRootValue)
    : path.resolve(desktopRoot, cloudRootValue);
  const apiOrigin = apiBaseUrl.origin;
  const webOrigin = webUrl.origin;

  return {
    apiBaseUrl: apiBaseUrl.toString().replace(/\/$/, ""),
    apiHealthUrl: new URL("/health", apiOrigin).toString(),
    apiHost: apiBaseUrl.hostname === "localhost" ? "127.0.0.1" : apiBaseUrl.hostname,
    apiPort: getUrlPort(apiBaseUrl),
    cloudRoot,
    webHealthUrl: new URL(
      "/login?client=desktop&state=desktop-dev-health&desktop_state=desktop-dev-health",
      webOrigin,
    ).toString(),
    webHost: webUrl.hostname === "localhost" ? "127.0.0.1" : webUrl.hostname,
    webOrigin,
    webPort: getUrlPort(webUrl),
  };
}

export async function probeLocalCloudService(
  service,
  { fetchImpl = globalThis.fetch, timeoutMs = 3_000 } = {},
) {
  try {
    const response = await fetchImpl(service.healthUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return { ready: false, detail: `HTTP ${response.status}` };
    }
    if (service.kind === "api") {
      const payload = await response.json();
      if (payload?.status !== "ready") {
        return { ready: false, detail: `API status is ${String(payload?.status ?? "unknown")}` };
      }
    } else {
      const body = await response.text();
      if (!body.includes("Puppyone") || !body.includes("Sign in")) {
        return { ready: false, detail: "login page marker is missing" };
      }
    }
    return { ready: true };
  } catch (error) {
    return {
      ready: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function prepareLocalCloudDevServices(
  config,
  {
    environment = process.env,
    fetchImpl = globalThis.fetch,
    logger = console,
    spawn = spawnManagedChild,
    startupTimeoutMs = 60_000,
  } = {},
) {
  const services = createServiceDefinitions(config, environment);
  const ownedProcesses = [];

  try {
    await Promise.all(services.map(async (service) => {
      const current = await probeLocalCloudService(service, { fetchImpl });
      if (current.ready) {
        logger.info(`[desktop-dev] Reusing healthy local Cloud ${service.name} at ${service.origin}.`);
        return;
      }

      assertServiceCanStart(service);
      logger.info(`[desktop-dev] Starting local Cloud ${service.name} at ${service.origin}.`);
      const child = spawn(service.command, service.args, {
        cwd: service.cwd,
        env: service.environment,
        stdio: "inherit",
      });
      const owned = { child, name: service.name };
      ownedProcesses.push(owned);
      await waitForServiceReady(service, child, {
        fetchImpl,
        startupTimeoutMs,
      });
      logger.info(`[desktop-dev] Local Cloud ${service.name} is ready.`);
    }));
  } catch (error) {
    for (const { child } of ownedProcesses) {
      terminateManagedChild(child);
    }
    throw error;
  }

  return {
    ownedProcesses,
    async probeAll() {
      return Promise.all(services.map(async (service) => ({
        name: service.name,
        ...(await probeLocalCloudService(service, { fetchImpl })),
      })));
    },
    stop() {
      for (const { child } of ownedProcesses) {
        terminateManagedChild(child);
      }
    },
  };
}

export function createServiceDefinitions(config, environment) {
  const backendRoot = path.join(config.cloudRoot, "backend");
  const frontendRoot = path.join(config.cloudRoot, "frontend");
  const defaultPython = process.platform === "win32"
    ? path.join(backendRoot, ".venv", "Scripts", "python.exe")
    : path.join(backendRoot, ".venv", "bin", "python");
  const python = environment.PUPPYONE_CLOUD_BACKEND_PYTHON ?? defaultPython;
  const npm = resolveNpmInvocation();

  return [
    {
      args: [
        "-m",
        "uvicorn",
        "src.main:app",
        "--host",
        config.apiHost,
        "--port",
        String(config.apiPort),
        "--log-level",
        "info",
        "--no-access-log",
      ],
      command: python,
      cwd: backendRoot,
      environment: {
        ...environment,
        FRONTEND_URL: config.webOrigin,
        // The sibling backend may carry a production PUBLIC_URL in its .env.
        // A local Desktop-managed API must advertise the exact loopback origin
        // that serves its Git smart-HTTP endpoints, otherwise the Desktop trust
        // check correctly rejects the returned canonical remote.
        PUBLIC_URL: new URL(config.apiHealthUrl).origin,
        PUPPYONE_PUBLIC_URL_OVERRIDE: new URL(config.apiHealthUrl).origin,
      },
      healthUrl: config.apiHealthUrl,
      kind: "api",
      name: "API",
      origin: new URL(config.apiHealthUrl).origin,
      requiredPath: python,
    },
    {
      args: [
        ...npm.argsPrefix,
        "run",
        "dev",
        "--",
        "-H",
        config.webHost,
        "-p",
        String(config.webPort),
      ],
      command: npm.command,
      cwd: frontendRoot,
      environment: {
        ...environment,
        NEXT_PUBLIC_API_URL: new URL(config.apiHealthUrl).origin,
      },
      healthUrl: config.webHealthUrl,
      kind: "web",
      name: "login web app",
      origin: config.webOrigin,
      requiredPath: path.join(frontendRoot, "package.json"),
    },
  ];
}

async function waitForServiceReady(
  service,
  child,
  { fetchImpl, startupTimeoutMs },
) {
  const deadline = Date.now() + startupTimeoutMs;
  let childFailure = null;
  const onError = (error) => {
    childFailure = error instanceof Error ? error.message : String(error);
  };
  const onExit = (code, signal) => {
    childFailure = `exited (${signal ?? code ?? "unknown"})`;
  };
  child.once("error", onError);
  child.once("exit", onExit);

  try {
    while (Date.now() < deadline) {
      if (childFailure) {
        throw new Error(`Local Cloud ${service.name} ${childFailure}. Check whether ${service.origin} is already occupied.`);
      }
      const result = await probeLocalCloudService(service, { fetchImpl });
      if (result.ready) return;
      await delay(500);
    }
  } finally {
    child.removeListener("error", onError);
    child.removeListener("exit", onExit);
  }

  throw new Error(`Timed out waiting for local Cloud ${service.name} at ${service.origin}.`);
}

function assertServiceCanStart(service) {
  if (!existsSync(service.cwd)) {
    throw new Error(`Local Cloud ${service.name} directory is missing: ${service.cwd}`);
  }
  if (!existsSync(service.requiredPath)) {
    throw new Error(`Local Cloud ${service.name} runtime is missing: ${service.requiredPath}`);
  }
}

export function parseConfiguredHttpUrl(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be configured.`);
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${label} is invalid.`);
  }
  if (
    !url.hostname
    || url.username
    || url.password
    || !["http:", "https:"].includes(url.protocol)
  ) {
    throw new Error(`${label} must be an HTTP(S) URL.`);
  }
  return url;
}

export function isLoopbackHostname(hostname) {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname === "[::1]";
}

function getUrlPort(url) {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
