import { describe, expect, it, vi } from "vitest";
import { createNativeSurfaceOcclusionCoordinator } from "../../../../electron/main/native-surfaces/occlusion-coordinator.mjs";

describe("native surface occlusion coordinator", () => {
  it("coordinates every surface for one owner without affecting other windows", () => {
    const coordinator = createNativeSurfaceOcclusionCoordinator();
    const first = vi.fn();
    const second = vi.fn();
    const otherOwner = vi.fn();

    const releaseFirst = coordinator.register({ ownerWebContentsId: 7, setOccluded: first });
    coordinator.register({ ownerWebContentsId: 7, setOccluded: second });
    coordinator.register({ ownerWebContentsId: 8, setOccluded: otherOwner });
    expect(first).toHaveBeenLastCalledWith(false);

    expect(coordinator.setOwnerOccluded(7, true)).toBe(true);
    expect(first).toHaveBeenLastCalledWith(true);
    expect(second).toHaveBeenLastCalledWith(true);
    expect(otherOwner).toHaveBeenCalledTimes(1);
    expect(coordinator.setOwnerOccluded(7, true)).toBe(false);

    releaseFirst();
    releaseFirst();
    coordinator.setOwnerOccluded(7, false);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenLastCalledWith(false);
  });

  it("immediately hides surfaces registered while an overlay is already open", () => {
    const coordinator = createNativeSurfaceOcclusionCoordinator();
    coordinator.setOwnerOccluded(11, true);
    const setOccluded = vi.fn();

    coordinator.register({ ownerWebContentsId: 11, setOccluded });
    expect(setOccluded).toHaveBeenCalledOnce();
    expect(setOccluded).toHaveBeenCalledWith(true);

    expect(coordinator.releaseOwner(11)).toBe(true);
    expect(setOccluded).toHaveBeenLastCalledWith(false);
    expect(coordinator.isOwnerOccluded(11)).toBe(false);
  });

  it("isolates callback failures and restores occlusion on disposal", () => {
    const onCallbackError = vi.fn();
    const coordinator = createNativeSurfaceOcclusionCoordinator({ onCallbackError });
    const healthy = vi.fn();
    coordinator.register({
      ownerWebContentsId: 4,
      setOccluded: () => { throw new Error("native teardown race"); },
    });
    coordinator.register({ ownerWebContentsId: 4, setOccluded: healthy });

    coordinator.setOwnerOccluded(4, true);
    coordinator.dispose();

    expect(onCallbackError).toHaveBeenCalledTimes(3);
    expect(healthy.mock.calls).toEqual([[false], [true], [false]]);
  });
});
