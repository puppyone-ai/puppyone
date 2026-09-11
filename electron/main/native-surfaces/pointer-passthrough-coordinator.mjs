import { createNativeSurfaceResizeCursor } from "./resize-cursor.mjs";

const FORWARDED_MOUSE_TYPES = new Set(["mouseMove", "mouseUp"]);
const INITIAL_ROUTED_MOUSE_TYPE = "mouseDown";

/**
 * Keeps renderer-owned resize gestures alive across native WebContentsViews.
 *
 * A child view receives OS mouse input before the BrowserWindow renderer.
 * Renderer-published regions provide passive hover/cursor feedback and recover
 * the initial primary press for an
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
  const hoverByOwner = new Map();
  const activeCursorByOwner = new Map();
  const ownerListeners = new Map();
  let disposed = false;

  function register({ ownerWebContentsId, ownerWebContents, surfaceView, onPointerDown, ownerWindow }) {
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
      cursor: createNativeSurfaceResizeCursor(surfaceWebContents, reportError),
    };
    registration.handleMouse = (event, mouse) => {
      if (!mouse?.type) return;
      const point = toOwnerMouseInput(mouse, surfaceView.getBounds());
      const hovered = mouse.type === "mouseLeave" ? null : regionAt(ownerWebContentsId, point);
      if (["mouseMove", "mouseDown", "mouseUp", "mouseLeave"].includes(mouse.type)) {
        setHover(ownerWebContentsId, hovered?.id ? { registration, region: hovered } : null);
      }
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
        if (routesInitialPress) {
          activeCursorByOwner.set(ownerWebContentsId, hovered?.cursor ?? "col-resize");
          setOwnerActive(ownerWebContentsId, true);
        }
        ownerWebContents.sendInputEvent(ownerInput);
      } catch (error) {
        if (routesInitialPress) setOwnerActive(ownerWebContentsId, false);
        try {
          onForwardError(error);
        } catch {
          // Diagnostics must never compromise input cleanup.
        }
      } finally {
        // The renderer also publishes its normal pointerup cleanup. Releasing
        // here is the main-process fail-safe if that renderer disappears.
        if (mouse.type === "mouseUp") setOwnerActive(ownerWebContentsId, false);
      }
    };

    const registrations = registrationsByOwner.get(ownerWebContentsId) ?? new Set();
    registrations.add(registration);
    if (!ownerListeners.has(ownerWebContentsId)) {
      const handleOwnerMouse = (_event, mouse) => {
        // Capture and layout changes can deliver the release to the Shell
        // instead of a child. The forwarded press may never acquire a renderer
        // lease, so its cleanup cannot depend on a renderer IPC acknowledgement.
        if (mouse?.type === "mouseUp" && isPrimaryMouseButton(mouse)) {
          setOwnerActive(ownerWebContentsId, false);
        }
        // DOM hover belongs to the DOM. Leaving a child must clear its explicit
        // feedback; forwarded active input must not cancel the native hover.
        if (!activeOwners.has(ownerWebContentsId)) setHover(ownerWebContentsId, null);
        if (mouse?.type === "mouseDown") {
          activeCursorByOwner.set(ownerWebContentsId, regionAt(ownerWebContentsId, mouse)?.cursor ?? "col-resize");
        }
      };
      const cancel = () => { setHover(ownerWebContentsId, null); setOwnerActive(ownerWebContentsId, false); };
      ownerWebContents.on?.("before-mouse-event", handleOwnerMouse);
      ownerWindow?.on?.("blur", cancel);
      ownerWindow?.on?.("hide", cancel);
      ownerListeners.set(ownerWebContentsId, () => {
        ownerWebContents.removeListener?.("before-mouse-event", handleOwnerMouse);
        ownerWindow?.removeListener?.("blur", cancel);
        ownerWindow?.removeListener?.("hide", cancel);
      });
    }
    registrationsByOwner.set(ownerWebContentsId, registrations);
    surfaceWebContents.on("before-mouse-event", registration.handleMouse);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (hoverByOwner.get(ownerWebContentsId)?.registration === registration) setHover(ownerWebContentsId, null);
      registration.cursor.dispose();
      surfaceWebContents.removeListener?.("before-mouse-event", registration.handleMouse);
      const current = registrationsByOwner.get(ownerWebContentsId);
      current?.delete(registration);
      if (current?.size === 0) {
        registrationsByOwner.delete(ownerWebContentsId);
        ownerListeners.get(ownerWebContentsId)?.();
        ownerListeners.delete(ownerWebContentsId);
      }
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
    updateCursors(ownerWebContentsId);
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
    setHover(ownerWebContentsId, null);
    return true;
  }

  function releaseOwner(ownerWebContentsId) {
    assertOwnerWebContentsId(ownerWebContentsId);
    setHover(ownerWebContentsId, null);
    const releasedActive = activeOwners.delete(ownerWebContentsId);
    activeCursorByOwner.delete(ownerWebContentsId);
    updateCursors(ownerWebContentsId);
    const releasedRegions = routingRegionsByOwner.delete(ownerWebContentsId);
    return releasedActive || releasedRegions;
  }

  function isOwnerActive(ownerWebContentsId) {
    assertOwnerWebContentsId(ownerWebContentsId);
    return activeOwners.has(ownerWebContentsId);
  }

  function regionAt(ownerWebContentsId, point) {
    return (routingRegionsByOwner.get(ownerWebContentsId) ?? []).find((region) => (
      point.x >= region.x && point.x < region.x + region.width &&
      point.y >= region.y && point.y < region.y + region.height
    ));
  }
  function pointFallsInsideOwnerRegion(ownerWebContentsId, point) {
    return Boolean(regionAt(ownerWebContentsId, point));
  }
  function reportError(error) {
    try { onForwardError(error); } catch { /* Diagnostics cannot break input. */ }
  }
  function updateCursors(owner) {
    const hover = hoverByOwner.get(owner);
    for (const registration of registrationsByOwner.get(owner) ?? []) {
      registration.cursor.set(activeOwners.has(owner) ? activeCursorByOwner.get(owner) ?? "col-resize"
        : hover?.registration === registration ? hover.region.cursor ?? "col-resize" : null);
    }
  }
  function setHover(owner, hover) {
    const previous = hoverByOwner.get(owner);
    if (previous?.region.id === hover?.region.id && previous?.registration === hover?.registration) return;
    if (hover) hoverByOwner.set(owner, hover);
    else hoverByOwner.delete(owner);
    const ownerContents = hover?.registration.ownerWebContents ?? previous?.registration.ownerWebContents;
    try { ownerContents?.send?.("native-surfaces:pointer-hover", { regionId: hover?.region.id ?? null }); }
    catch (error) { reportError(error); }
    updateCursors(owner);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const owner of hoverByOwner.keys()) setHover(owner, null);
    activeOwners.clear();
    activeCursorByOwner.clear();
    for (const release of ownerListeners.values()) release();
    ownerListeners.clear();
    routingRegionsByOwner.clear();
    for (const registrations of registrationsByOwner.values()) {
      for (const registration of registrations) {
        registration.cursor.dispose();
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
    if (region.id !== undefined) {
      if (!Number.isSafeInteger(region.id) || region.id <= 0) throw new TypeError("Invalid pointer region id.");
      normalized.id = region.id;
    }
    if (region.cursor !== undefined) {
      if (!["col-resize", "row-resize"].includes(region.cursor)) throw new TypeError("Invalid pointer region cursor.");
      normalized.cursor = region.cursor;
    }
    return Object.freeze(normalized);
  });
}

function sameRoutingRegions(first, second) {
  return first.length === second.length && first.every((region, index) => {
    const candidate = second[index];
    return region.id === candidate.id && region.cursor === candidate.cursor && region.x === candidate.x &&
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
