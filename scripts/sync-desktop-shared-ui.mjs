import { desktopSharedUiVendor, syncSharedUiTo } from "./shared-ui-sync-lib.mjs";

await syncSharedUiTo(desktopSharedUiVendor);
console.log(`Synced frontend/shared-ui -> ${desktopSharedUiVendor}`);

