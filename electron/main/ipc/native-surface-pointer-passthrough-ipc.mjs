export const NATIVE_SURFACE_POINTER_PASSTHROUGH_CHANNEL =
  "native-surfaces:set-pointer-passthrough";
export const NATIVE_SURFACE_POINTER_ROUTING_REGIONS_CHANNEL =
  "native-surfaces:set-pointer-routing-regions";
const MAX_POINTER_ROUTING_REGIONS = 64;

/** Registers the trusted, owner-scoped native pointer routing signal. */
export function registerNativeSurfacePointerPassthroughIpcHandlers({ ipcMain, coordinator }) {
  if (!ipcMain || typeof ipcMain.on !== "function") {
    throw new TypeError("Trusted ipcMain is required for native surface pointer passthrough.");
  }
  if (
    !coordinator ||
    typeof coordinator.setOwnerActive !== "function" ||
    typeof coordinator.setOwnerRoutingRegions !== "function"
  ) {
    throw new TypeError("Native surface pointer passthrough coordinator is required.");
  }

  ipcMain.on(NATIVE_SURFACE_POINTER_PASSTHROUGH_CHANNEL, (event, request) => {
    if (typeof request?.active !== "boolean") return;
    const ownerWebContentsId = event?.sender?.id;
    if (!Number.isSafeInteger(ownerWebContentsId) || ownerWebContentsId <= 0) return;
    coordinator.setOwnerActive(ownerWebContentsId, request.active);
  });

  ipcMain.on(NATIVE_SURFACE_POINTER_ROUTING_REGIONS_CHANNEL, (event, request) => {
    const ownerWebContentsId = event?.sender?.id;
    if (!Number.isSafeInteger(ownerWebContentsId) || ownerWebContentsId <= 0) return;
    const regions = parseRoutingRegions(request?.regions);
    if (!regions) return;
    coordinator.setOwnerRoutingRegions(ownerWebContentsId, regions);
  });
}

function parseRoutingRegions(value) {
  if (!Array.isArray(value) || value.length > MAX_POINTER_ROUTING_REGIONS) return null;
  const regions = [];
  for (const candidate of value) {
    const region = {
      x: candidate?.x,
      y: candidate?.y,
      width: candidate?.width,
      height: candidate?.height,
    };
    if (
      !Number.isSafeInteger(region.x) ||
      !Number.isSafeInteger(region.y) ||
      !Number.isSafeInteger(region.width) ||
      !Number.isSafeInteger(region.height) ||
      region.x < 0 ||
      region.y < 0 ||
      region.width <= 0 ||
      region.height <= 0
    ) {
      return null;
    }
    if (candidate.id !== undefined) {
      if (!Number.isSafeInteger(candidate.id) || candidate.id <= 0) return null;
      region.id = candidate.id;
    }
    if (candidate.cursor !== undefined) {
      if (!["col-resize", "row-resize"].includes(candidate.cursor)) return null;
      region.cursor = candidate.cursor;
    }
    regions.push(region);
  }
  return regions;
}
