import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import { createTestConfig } from "./vitest.config.ts";

const include = [
  "tests/unit/updates/policy/desktopUpdatePolicy.test.mjs",
  "tests/unit/updates/installation/electron.update-service.test.mjs",
  "tests/integration/updates/installation/desktopUpdateFeedRouting.test.mjs",
  "tests/unit/release/build-identity/desktopReleaseVersionPolicy.test.mjs",
  "tests/unit/updates/installation/electron.native-update-menu-action.test.mjs",
  "tests/unit/updates/notifications/desktopUpdateTitlebarModel.test.ts",
  "tests/component/updates/notifications/desktopUpdateSettingsRow.test.tsx",
  "tests/component/updates/notifications/desktopUpdateTitlebarButton.test.tsx",
  "tests/component/updates/preferences/automaticUpdateDownloadSettingRow.test.tsx",
  "tests/component/updates/preferences/desktopUpdatesController.test.tsx",
  "tests/unit/updates/preferences/electron.update-preference-store.test.mjs",
  "tests/architecture/updates/installation/desktop-update.architecture.test.ts",
  "tests/architecture/release/ci/ciIntegrationGates.test.mjs",
];

export default defineConfig(async () => mergeConfig(await createTestConfig({ include }), {
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "electron/update-service.mjs",
        "electron/main/native-update-menu-action.mjs",
        "electron/main/updates/update-preference-store.mjs",
        "scripts/release-support/desktop-release-version-policy.mjs",
        "shared/desktop/update-policy.mjs",
        "src/features/updates/updateModel.ts",
        "src/features/updates/useDesktopUpdates.ts",
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
