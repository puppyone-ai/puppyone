import { describe, expect, it, vi } from "vitest";
import { createHostLiveness } from "../../../../electron/main/item-hosts/host-liveness.mjs";

function fixture() {
  let time = 0;
  const probe = vi.fn(), change = vi.fn();
  const health = createHostLiveness({ timeoutMs: 15000, now: () => time, probe, onChange: change });
  return { health, probe, change, advance(ms) { time += ms; health.tick(); } };
}

describe("execution liveness observation", () => {
  it("allows queued heartbeats after sleep, a clock jump, or a stalled supervisor", () => {
    const f = fixture();
    f.advance(120000);
    expect(f.probe).not.toHaveBeenCalled();
    f.health.observe();
    f.advance(2000);
    expect(f.change).not.toHaveBeenCalled();
    f.advance(-50000);
    expect(f.health.snapshot().state).toBe("responsive");
  });
  it("probes independently, reports suspicion, and recovers on a late heartbeat", () => {
    const f = fixture();
    for (let index = 0; index < 8; index++) f.advance(2000);
    expect(f.probe).toHaveBeenCalledOnce();
    expect(f.change).not.toHaveBeenCalled();
    f.advance(2000);
    expect(f.change).toHaveBeenLastCalledWith("unresponsive");
    for (let index = 0; index < 60; index++) f.advance(2000);
    expect(f.probe).toHaveBeenCalledOnce();
    f.health.observe();
    expect(f.change).toHaveBeenLastCalledWith("responsive");
  });
  it("does not confuse a long silent Agent turn with a missing host heartbeat", () => {
    const f = fixture();
    for (let index = 0; index < 1800; index++) { f.health.observe(); f.advance(2000); }
    expect(f.probe).not.toHaveBeenCalled();
    expect(f.change).not.toHaveBeenCalled();
  });
});
