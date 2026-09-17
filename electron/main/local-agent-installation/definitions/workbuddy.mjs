import path from "node:path";

const MACOS_APP_CLI_RELATIVE_PATH = Object.freeze([
  "Contents",
  "Resources",
  "app.asar.unpacked",
  "cli",
  "bin",
  "codebuddy",
]);

export const workBuddyInstallationDefinition = Object.freeze({
  id: "workbuddy",
  displayName: "WorkBuddy",
  executableNames: Object.freeze(["codebuddy", "cbc"]),
  candidatePaths: ({ env, homedir, platform }) => {
    const candidates = [
      env?.CODEBUDDY_CODE_PATH
        ? { path: env.CODEBUDDY_CODE_PATH, source: "environment-override" }
        : null,
    ];
    if (platform === "win32") {
      candidates.push({
        path: path.join(homedir, "AppData", "Local", "codebuddy", "bin", "codebuddy.exe"),
        source: "product-fallback",
      });
    } else {
      candidates.push({
        path: path.join(homedir, ".local", "bin", "codebuddy"),
        source: "product-fallback",
      });
    }
    if (platform === "darwin") {
      for (const applicationsRoot of ["/Applications", path.join(homedir, "Applications")]) {
        for (const appName of ["WorkBuddy AI.app", "WorkBuddy.app"]) {
          candidates.push({
            path: path.join(applicationsRoot, appName, ...MACOS_APP_CLI_RELATIVE_PATH),
            source: "product-fallback",
          });
        }
      }
    }
    return candidates.filter(Boolean);
  },
  identityPolicy: Object.freeze({
    requiredForInvocations: Object.freeze(["cbc"]),
    packageNames: Object.freeze([
      "@tencent-ai/codebuddy-code",
      "@genie/agent-cli",
    ]),
    pathFragments: Object.freeze([
      "/codebuddy-code/",
      "/workbuddy",
      "/codebuddy/",
    ]),
    fileMarkers: Object.freeze([
      "__codebuddy_process_start_time__",
      "codebuddy code",
    ]),
  }),
});
