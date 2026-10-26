/** Liveness is suspicion, not process-exit evidence. A delayed supervisor tick
 * grants a fresh observation window after sleep or a busy Main event loop.
 * Neither a missing heartbeat nor a missing probe authorizes termination.
 */
export function createHostLiveness({ timeoutMs, intervalMs = 2000, now = () => performance.now(),
  probe, onChange = () => {} }) {
  let lastTick = now();
  let lastSeen = lastTick;
  let state = "responsive";
  let probeSent = false;
  const change = (next) => {
    if (state === next) return;
    state = next;
    onChange(next);
  };
  return {
    observe() { lastSeen = now(); probeSent = false; change("responsive"); },
    tick() {
      const time = now();
      if (time - lastTick > intervalMs * 2 || time < lastTick) {
        lastSeen = time;
        probeSent = false;
      }
      lastTick = time;
      if (time - lastSeen <= timeoutMs) return;
      if (!probeSent) { probeSent = true; probe(); return; }
      change("unresponsive");
    },
    snapshot: () => ({ state, lastSeen, probeSent }),
  };
}
