import {
  acquireNativeSurfacePointerPassthroughLease,
  type NativeSurfacePointerPassthroughOwner,
} from "./nativeSurfacePointerPassthrough";
import { acquireNativeSurfaceLayoutLease } from "./nativeSurfaceGeometry";

/** Direct manipulation needs input continuity and live geometry, not occlusion. */
export function acquireNativeSurfaceResizeLease(
  owner: NativeSurfacePointerPassthroughOwner,
  sessionId?: string,
) {
  const pointer = acquireNativeSurfacePointerPassthroughLease(owner, sessionId);
  const layout = acquireNativeSurfaceLayoutLease(`${owner}:resize`);
  return { ...pointer, release() { pointer.release(); layout.release(); } };
}
