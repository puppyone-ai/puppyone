import type { CapabilityPrincipal } from "../security/capabilityPrincipal";

export type AsyncRenderKey = {
  featureId: string;
  elementKey: string;
  source: string;
  themeKey: string;
  policyVersion: string;
  principalKey: string;
};

export type AsyncRenderJob<T> = {
  key: AsyncRenderKey;
  principal: CapabilityPrincipal;
  run: (signal: AbortController) => Promise<T>;
};

type InFlightEntry<T> = {
  keyFingerprint: string;
  controller: AbortController;
  promise: Promise<T>;
  generation: number;
};

/**
 * Shared async render broker: dedupe, cancellation, stale-result suppression.
 * Authority-bearing results must not be shared across principals.
 */
export function createAsyncRenderBroker() {
  const inFlight = new Map<string, InFlightEntry<unknown>>();
  let generation = 0;

  return {
    async run<T>(job: AsyncRenderJob<T>): Promise<{ value: T; generation: number } | null> {
      const fingerprint = fingerprintKey(job.key);
      const existing = inFlight.get(fingerprint) as InFlightEntry<T> | undefined;
      if (existing) {
        const value = await existing.promise;
        return { value, generation: existing.generation };
      }

      const controller = new AbortController();
      const currentGeneration = ++generation;
      const promise = job.run(controller);
      inFlight.set(fingerprint, {
        keyFingerprint: fingerprint,
        controller,
        promise: promise as Promise<unknown>,
        generation: currentGeneration,
      });

      try {
        const value = await promise;
        const current = inFlight.get(fingerprint);
        if (!current || current.generation !== currentGeneration) return null;
        return { value, generation: currentGeneration };
      } finally {
        const current = inFlight.get(fingerprint);
        if (current?.generation === currentGeneration) inFlight.delete(fingerprint);
      }
    },

    abort(fingerprintOrPrefix: string) {
      for (const [key, entry] of inFlight) {
        if (key === fingerprintOrPrefix || key.startsWith(fingerprintOrPrefix)) {
          entry.controller.abort();
          inFlight.delete(key);
        }
      }
    },

    disposeAll() {
      for (const entry of inFlight.values()) entry.controller.abort();
      inFlight.clear();
    },
  };
}

function fingerprintKey(key: AsyncRenderKey): string {
  return [
    key.featureId,
    key.elementKey,
    key.source,
    key.themeKey,
    key.policyVersion,
    key.principalKey,
  ].join("\u0000");
}

export type AsyncRenderBroker = ReturnType<typeof createAsyncRenderBroker>;
