import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import desktopConfig from "../../vite.config.ts";

export default mergeConfig(desktopConfig, defineConfig({
  test: {
    include: [
      "tests/unit/updates/policy/desktopUpdatePolicy.test.mjs",
      "tests/unit/updates/installation/electron.update-service.test.mjs",
      "tests/unit/release/build-identity/desktopReleaseVersionPolicy.test.mjs",
      "tests/unit/updates/installation/electron.native-update-menu-action.test.mjs",
      "tests/unit/updates/notifications/desktopUpdateTitlebarModel.test.ts",
      "tests/component/updates/notifications/desktopUpdateSettingsRow.test.tsx",
      "tests/architecture/updates/installation/desktop-update.architecture.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "artifacts/tests/coverage/updater-p0",
      include: [
        "electron/update-service.mjs",
        "electron/main/native-update-menu-action.mjs",
        "scripts/release-support/desktop-release-version-policy.mjs",
        "shared/desktop/update-policy.mjs",
        "src/features/updates/updateModel.ts",
      ],
      thresholds: {
        statements: 70,
        branches: 65,
        functions: 75,
        lines: 75,
      },
    },
  },
}));
