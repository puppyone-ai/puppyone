import { mapConcurrent } from "./drivers/shared.mjs";

export function createModelDiscoveryService({ drivers, request, now = Date.now }) {
  let pending = null;
  let last = null;
  let lastAt = 0;
  let disposed = false;
  let controller = null;
  return {
    discover() {
      if (disposed) return Promise.resolve([]);
      if (pending) return pending;
      if (last && now() - lastAt < 3000) return Promise.resolve(structuredClone(last));
      controller = new AbortController();
      const candidates = drivers.flatMap((driver) => (driver.candidates ?? []).map((candidate) => ({ driver, candidate })));
      pending = mapConcurrent(candidates, 2, async ({ driver, candidate }) => {
        try { return await driver.probe(candidate, request, { signal: controller.signal }) ? candidate : null; }
        catch { return null; }
      }).then((results) => {
        last = disposed ? [] : results.filter(Boolean);
        lastAt = now();
        return structuredClone(last);
      }).finally(() => { pending = null; controller = null; });
      return pending;
    },
    dispose() { disposed = true; controller?.abort(); last = null; },
  };
}
