import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import { createTestConfig } from "./vitest.config.ts";

const include = [
  "tests/unit/updates/policy/desktopUpdatePolicy.test.mjs",
  "tests/unit/updates/installation/electron.update-service.test.mjs",
  "tests/unit/release/build-identity/desktopReleaseVersionPolicy.test.mjs",
  "tests/unit/updates/installation/electron.native-update-menu-action.test.mjs",
  "tests/unit/updates/notifications/desktopUpdateTitlebarModel.test.ts",
  "tests/component/updates/notifications/desktopUpdateSettingsRow.test.tsx",
  "tests/architecture/updates/installation/desktop-update.architecture.test.ts",
];

export default defineConfig(async () => mergeConfig(await createTestConfig({ include }), {
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
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
