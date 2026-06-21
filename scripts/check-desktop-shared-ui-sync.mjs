import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  compareDirectories,
  desktopSharedUiVendor,
  syncSharedUiTo,
} from "./shared-ui-sync-lib.mjs";

const tempRoot = mkdtempSync(path.join(tmpdir(), "puppyone-shared-ui-"));
const expected = path.join(tempRoot, "shared-ui");

try {
  await syncSharedUiTo(expected);
  const differences = compareDirectories(expected, desktopSharedUiVendor);
  if (differences.length > 0) {
    console.error("desktop/vendor/shared-ui is out of sync with frontend/shared-ui:");
    for (const difference of differences.slice(0, 50)) {
      console.error(`- ${difference}`);
    }
    if (differences.length > 50) {
      console.error(`...and ${differences.length - 50} more`);
    }
    process.exit(1);
  }
  console.log("desktop/vendor/shared-ui is in sync.");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

