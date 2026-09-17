import path from "node:path";

const MACOS_APP_CLI_RELATIVE_PATH = Object.freeze([
  "Contents",
  "Resources",
  "app.asar.unpacked",
  "cli",
  "bin",
  "codebuddy",
]);

function workBuddyInstallationDefinition({
  id,
  displayName,
  appName,
  route,
  overrideEnvironmentVariable,
}) {
  return Object.freeze({
    id,
    displayName,
    executableNames: Object.freeze(["codebuddy"]),
    // `codebuddy` on PATH is a multi-channel CLI. A stable product identity
    // requires an exact desktop-app path or an explicitly routed override.
    searchPath: false,
    candidatePaths: ({ env, homedir, platform }) => {
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
    }),
  });
}

export const workBuddyChinaInstallationDefinition = workBuddyInstallationDefinition({
  id: "workbuddy-china",
  displayName: "WorkBuddy (China)",
  appName: "WorkBuddy.app",
  route: "internal",
  overrideEnvironmentVariable: "WORKBUDDY_CHINA_CODE_PATH",
});

export const workBuddyInternationalInstallationDefinition = workBuddyInstallationDefinition({
  id: "workbuddy-international",
  displayName: "WorkBuddy (International)",
  appName: "WorkBuddy AI.app",
  route: "public",
  overrideEnvironmentVariable: "WORKBUDDY_INTERNATIONAL_CODE_PATH",
});
