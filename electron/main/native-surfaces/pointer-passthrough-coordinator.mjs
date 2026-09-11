const FORWARDED_MOUSE_TYPES = new Set(["mouseMove", "mouseUp"]);
const INITIAL_ROUTED_MOUSE_TYPE = "mouseDown";

/**
 * Keeps renderer-owned resize gestures alive across native WebContentsViews.
 *
 * A child view receives OS mouse input before the BrowserWindow renderer.
 * Renderer-published routing regions recover the initial primary press for an
 * overlay sash; while an owner-scoped drag is active, move/up events are then
 * translated back into owner coordinates. The native view remains attached
 * and visible throughout the gesture.
 */
export function createNativeSurfacePointerPassthroughCoordinator({
  onForwardError = () => {},
} = {}) {
  const registrationsByOwner = new Map();
  const activeOwners = new Set();
  const routingRegionsByOwner = new Map();
  let disposed = false;

  function register({ ownerWebContentsId, ownerWebContents, surfaceView, onPointerDown }) {
    assertOwnerWebContentsId(ownerWebContentsId);
    if (disposed) throw new Error("Native surface pointer passthrough coordinator is disposed.");
    if (!ownerWebContents || typeof ownerWebContents.sendInputEvent !== "function") {
      throw new TypeError("Native surface owner WebContents is required.");
    }
    const surfaceWebContents = surfaceView?.webContents;
    if (
      !surfaceView ||
      typeof surfaceView.getBounds !== "function" ||
      !surfaceWebContents ||
      typeof surfaceWebContents.on !== "function"
    ) {
      throw new TypeError("Native surface WebContentsView is required.");
    }

    const registration = {
      ownerWebContents,
      ownerWebContentsId,
      surfaceView,
      surfaceWebContents,
      handleMouse: null,
    };
    registration.handleMouse = (event, mouse) => {
      if (!mouse?.type) return;
      const canRouteInitialPress =
        mouse?.type === INITIAL_ROUTED_MOUSE_TYPE &&
        isPrimaryMouseButton(mouse) &&
        routingRegionsByOwner.has(ownerWebContentsId);
      const routesActiveGesture =
        activeOwners.has(ownerWebContentsId) && FORWARDED_MOUSE_TYPES.has(mouse?.type);
      if (!canRouteInitialPress && !routesActiveGesture) {
        if (mouse.type === "mouseDown") onPointerDown?.();
        return;
      }
      const ownerInput = toOwnerMouseInput(mouse, surfaceView.getBounds());
      const routesInitialPress =
        canRouteInitialPress && pointFallsInsideOwnerRegion(ownerWebContentsId, ownerInput);
      if (!routesInitialPress && !routesActiveGesture) {
        if (mouse?.type === "mouseDown") onPointerDown?.();
        return;
      }

      event?.preventDefault?.();
      try {
        if (routesInitialPress) activeOwners.add(ownerWebContentsId);
        ownerWebContents.sendInputEvent(ownerInput);
      } catch (error) {
        if (routesInitialPress) activeOwners.delete(ownerWebContentsId);
        try {
          onForwardError(error);
        } catch {
          // Diagnostics must never compromise input cleanup.
        }
      } finally {
        // The renderer also publishes its normal pointerup cleanup. Releasing
        // here is the main-process fail-safe if that renderer disappears.
        if (mouse.type === "mouseUp") activeOwners.delete(ownerWebContentsId);
      }
    };

    const registrations = registrationsByOwner.get(ownerWebContentsId) ?? new Set();
    registrations.add(registration);
    registrationsByOwner.set(ownerWebContentsId, registrations);
    surfaceWebContents.on("before-mouse-event", registration.handleMouse);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      surfaceWebContents.removeListener?.("before-mouse-event", registration.handleMouse);
      const current = registrationsByOwner.get(ownerWebContentsId);
      current?.delete(registration);
      if (current?.size === 0) registrationsByOwner.delete(ownerWebContentsId);
    };
  }

  function setOwnerActive(ownerWebContentsId, active) {
    assertOwnerWebContentsId(ownerWebContentsId);
    if (disposed) return false;
    if (typeof active !== "boolean") {
      throw new TypeError("Native surface pointer passthrough state must be boolean.");
    }
    const current = activeOwners.has(ownerWebContentsId);
    if (current === active) return false;
    if (active) activeOwners.add(ownerWebContentsId);
    else activeOwners.delete(ownerWebContentsId);
    return true;
  }

  function setOwnerRoutingRegions(ownerWebContentsId, regions) {
    assertOwnerWebContentsId(ownerWebContentsId);
    if (disposed) return false;
    const normalized = normalizeRoutingRegions(regions);
    const current = routingRegionsByOwner.get(ownerWebContentsId) ?? [];
    if (sameRoutingRegions(current, normalized)) return false;
    if (normalized.length === 0) routingRegionsByOwner.delete(ownerWebContentsId);
    else routingRegionsByOwner.set(ownerWebContentsId, normalized);
    return true;
  }

  function releaseOwner(ownerWebContentsId) {
    assertOwnerWebContentsId(ownerWebContentsId);
    const releasedActive = activeOwners.delete(ownerWebContentsId);
    const releasedRegions = routingRegionsByOwner.delete(ownerWebContentsId);
    return releasedActive || releasedRegions;
  }

  function isOwnerActive(ownerWebContentsId) {
    assertOwnerWebContentsId(ownerWebContentsId);
    return activeOwners.has(ownerWebContentsId);
  }

  function pointFallsInsideOwnerRegion(ownerWebContentsId, point) {
    return (routingRegionsByOwner.get(ownerWebContentsId) ?? []).some((region) => (
      point.x >= region.x &&
      point.x < region.x + region.width &&
      point.y >= region.y &&
      point.y < region.y + region.height
    ));
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    activeOwners.clear();
    routingRegionsByOwner.clear();
    for (const registrations of registrationsByOwner.values()) {
      for (const registration of registrations) {
        registration.surfaceWebContents.removeListener?.(
          "before-mouse-event",
          registration.handleMouse,
        );
      }
    }
    registrationsByOwner.clear();
  }

  return Object.freeze({
    register,
    setOwnerActive,
    setOwnerRoutingRegions,
    releaseOwner,
    isOwnerActive,
    dispose,
  });
}

function toOwnerMouseInput(mouse, surfaceBounds) {
  const input = {
    type: mouse.type,
    x: Math.round(surfaceBounds.x + mouse.x),
    y: Math.round(surfaceBounds.y + mouse.y),
  };
  if (mouse.button) input.button = mouse.button;
  else if (mouse.type === "mouseDown" || mouse.type === "mouseUp") input.button = "left";
  if (Number.isFinite(mouse.clickCount)) input.clickCount = mouse.clickCount;
  if (Number.isFinite(mouse.movementX)) input.movementX = mouse.movementX;
  if (Number.isFinite(mouse.movementY)) input.movementY = mouse.movementY;
  if (Array.isArray(mouse.modifiers)) input.modifiers = [...mouse.modifiers];
  // before-mouse-event reports the pressed button but can omit modifiers.
  // sendInputEvent needs its down modifier to preserve DOM pointer capture.
  if (mouse.type === "mouseMove" && ["left", "middle", "right"].includes(mouse.button)) {
    input.modifiers = [...new Set([...(input.modifiers ?? []), `${mouse.button}buttondown`])];
  }
  return input;
}

function isPrimaryMouseButton(mouse) {
  return mouse?.button === undefined || mouse.button === "left";
}

function normalizeRoutingRegions(regions) {
  if (!Array.isArray(regions)) {
    throw new TypeError("Native surface pointer routing regions must be an array.");
  }
  return regions.map((region) => {
    const normalized = {
      x: Number(region?.x),
      y: Number(region?.y),
      width: Number(region?.width),
      height: Number(region?.height),
    };
    if (
      !Number.isSafeInteger(normalized.x) ||
      !Number.isSafeInteger(normalized.y) ||
      !Number.isSafeInteger(normalized.width) ||
      !Number.isSafeInteger(normalized.height) ||
      normalized.x < 0 ||
      normalized.y < 0 ||
      normalized.width <= 0 ||
      normalized.height <= 0
    ) {
      throw new TypeError("Native surface pointer routing region is invalid.");
    }
    return Object.freeze(normalized);
  });
}

function sameRoutingRegions(first, second) {
  return first.length === second.length && first.every((region, index) => {
    const candidate = second[index];
    return region.x === candidate.x &&
      region.y === candidate.y &&
      region.width === candidate.width &&
      region.height === candidate.height;
  });
}

function assertOwnerWebContentsId(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("Native surface owner WebContents id must be a positive integer.");
  }
}
