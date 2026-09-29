import path from "node:path";

const MACOS_APP_CLI_RELATIVE_PATH = Object.freeze([
  "Contents",
  "Resources",
  "app.asar.unpacked",
  "cli",
  "bin",
  "codebuddy",
]);

const WINDOWS_APP_CLI_RELATIVE_PATH = Object.freeze([
  "resources",
  "app.asar.unpacked",
  "cli",
  "bin",
  "codebuddy",
]);

function workBuddyInstallationDefinition({
  id,
  displayName,
  appName,
  windowsApplicationNames,
  endpoints,
  route,
  overrideEnvironmentVariable,
}) {
  return Object.freeze({
    id,
    displayName,
    executableNames: Object.freeze(["codebuddy"]),
    registeredApplicationNames: Object.freeze([...windowsApplicationNames]),
    // `codebuddy` on PATH is a multi-channel CLI. A stable product identity
    // requires an exact desktop-app path or an explicitly routed override.
    searchPath: false,
    candidatePaths: ({ env, homedir, platform, registeredApplications = [] }) => {
      const candidates = [
        env?.[overrideEnvironmentVariable]
          ? { path: env[overrideEnvironmentVariable], source: "environment-override" }
          : null,
        env?.CODEBUDDY_CODE_PATH
          && String(env.CODEBUDDY_INTERNET_ENVIRONMENT || "").trim().toLowerCase() === route
          ? { path: env.CODEBUDDY_CODE_PATH, source: "environment-override" }
          : null,
      ];
      if (platform === "darwin") {
        for (const applicationsRoot of ["/Applications", path.join(homedir, "Applications")]) {
          candidates.push({
            path: path.join(applicationsRoot, appName, ...MACOS_APP_CLI_RELATIVE_PATH),
            source: "product-fallback",
          });
        }
      }
      if (platform === "win32") {
        for (const registration of registeredApplications) {
          if (!windowsApplicationNames.some((name) => (
            registration?.applicationName?.toLowerCase() === name.toLowerCase()
          ))) continue;
          const cliPath = path.join(
            path.dirname(registration.executablePath),
            ...WINDOWS_APP_CLI_RELATIVE_PATH,
          );
          const productManifestPath = path.join(path.dirname(path.dirname(cliPath)), "product.json");
          candidates.push({
            path: cliPath,
            launcherPath: registration.executablePath,
            argsPrefix: [cliPath],
            environmentOverrides: { ELECTRON_RUN_AS_NODE: "1" },
            identityFilePath: productManifestPath,
            requiresManifestIdentity: true,
            identityMismatchAsNotFound: true,
            source: registration.source,
          });
        }
      }
      return candidates.filter(Boolean);
    },
    identityPolicy: Object.freeze({
      requiredForInvocations: Object.freeze(["codebuddy"]),
      packageNames: Object.freeze([
        "@tencent-ai/codebuddy-code",
        "@genie/agent-cli",
      ]),
      pathFragments: Object.freeze([`/${appName.toLowerCase()}/`]),
      fileMarkers: Object.freeze([
        "__codebuddy_process_start_time__",
        "codebuddy code",
      ]),
      manifest: Object.freeze({
        parentDepth: 1,
        fileName: "product.json",
        property: "endpoint",
        values: Object.freeze([...endpoints]),
      }),
    }),
  });
}

export const workBuddyChinaInstallationDefinition = workBuddyInstallationDefinition({
  id: "workbuddy-china",
  displayName: "WorkBuddy (China)",
  appName: "WorkBuddy.app",
  windowsApplicationNames: ["WorkBuddy.exe"],
  endpoints: ["https://www.workbuddy.cn", "https://www.codebuddy.cn"],
  route: "internal",
  overrideEnvironmentVariable: "WORKBUDDY_CHINA_CODE_PATH",
});

export const workBuddyInternationalInstallationDefinition = workBuddyInstallationDefinition({
  id: "workbuddy-international",
  displayName: "WorkBuddy (International)",
  appName: "WorkBuddy AI.app",
  windowsApplicationNames: ["WorkBuddy.exe", "WorkBuddy AI.exe"],
  endpoints: ["https://www.workbuddy.ai", "https://www.codebuddy.ai"],
  route: "public",
  overrideEnvironmentVariable: "WORKBUDDY_INTERNATIONAL_CODE_PATH",
});
