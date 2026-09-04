import { describe, expect, it } from "vitest";
import {
  createSurfaceRecoveryState,
  resolveAutomaticSurfaceRecovery,
  resolveManualSurfaceRecovery,
} from "../src/features/editor-surfaces/surfaceRecoveryPolicy";

const PDF_RECOVERY = Object.freeze({ maxAutomaticRetries: 1, supportsSafeMode: true });
const NATIVE_PDF_RECOVERY = Object.freeze({ maxAutomaticRetries: 1, supportsSafeMode: false });
const NO_RECOVERY = Object.freeze({ maxAutomaticRetries: 0, supportsSafeMode: false });

describe("isolated Editor Surface recovery policy", () => {
  it("enters safe mode once after a native renderer crash", () => {
    const first = resolveAutomaticSurfaceRecovery({
      current: createSurfaceRecoveryState("pdf-a"),
      identity: "pdf-a",
      policy: PDF_RECOVERY,
    });

    expect(first).toEqual({
      identity: "pdf-a",
      safeMode: true,
      retryGeneration: 1,
      automaticRetries: 1,
    });
    expect(resolveAutomaticSurfaceRecovery({
      current: first!,
      identity: "pdf-a",
      policy: PDF_RECOVERY,
    })).toBeNull();
  });

  it("does not change viewers that have not opted into safe mode", () => {
    expect(resolveAutomaticSurfaceRecovery({
      current: createSurfaceRecoveryState("markdown"),
      identity: "markdown",
      policy: NO_RECOVERY,
    })).toBeNull();
  });

  it("retries a browser-engine surface once without inventing a safe mode", () => {
    expect(resolveAutomaticSurfaceRecovery({
      current: createSurfaceRecoveryState("native-pdf"),
      identity: "native-pdf",
      policy: NATIVE_PDF_RECOVERY,
    })).toEqual({
      identity: "native-pdf",
      safeMode: false,
      retryGeneration: 1,
      automaticRetries: 1,
    });
  });

  it("starts with a fresh retry budget for a different document", () => {
    const exhausted = {
      identity: "pdf-a",
      safeMode: true,
      retryGeneration: 1,
      automaticRetries: 1,
    } as const;
    expect(resolveAutomaticSurfaceRecovery({
      current: exhausted,
      identity: "pdf-b",
      policy: PDF_RECOVERY,
    })).toEqual({
      identity: "pdf-b",
      safeMode: true,
      retryGeneration: 1,
      automaticRetries: 1,
    });
  });

  it("keeps manual retries available without consuming automatic retry budget", () => {
    expect(resolveManualSurfaceRecovery({
      current: createSurfaceRecoveryState("pdf-a"),
      identity: "pdf-a",
      policy: PDF_RECOVERY,
    })).toEqual({
      identity: "pdf-a",
      safeMode: true,
      retryGeneration: 1,
      automaticRetries: 0,
    });
  });
});
