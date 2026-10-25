import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Each Desktop channel is paired with exactly one Cloud environment:
// Internal builds exercise the Qubits staging Cloud before promotion, Stable
// builds talk to production. A channel never silently points at the other.
const workflow = (name) =>
  readFileSync(new URL(`../../../../.github/workflows/${name}`, import.meta.url), "utf8");

const endpoints = (source) => ({
  api: [...source.matchAll(/^\s*VITE_DESKTOP_CLOUD_API_URL:\s*(\S+)\s*$/gm)].map((m) => m[1]),
  web: [...source.matchAll(/^\s*VITE_DESKTOP_CLOUD_WEB_URL:\s*(\S+)\s*$/gm)].map((m) => m[1]),
});

describe("Desktop channel to Cloud environment pairing", () => {
  it("builds Internal packages against the Qubits staging Cloud", () => {
    expect(endpoints(workflow("desktop-internal-build.yml"))).toEqual({
      api: ["https://qubits-api.puppyone.ai/api/v1"],
      web: ["https://qubits-try.puppyone.ai"],
    });
  });

  it("builds every Stable platform against the production Cloud", () => {
    const stable = endpoints(workflow("desktop-stable-release.yml"));
    expect(stable.api.length).toBeGreaterThan(0);
    expect(new Set(stable.api)).toEqual(new Set(["https://api.puppyone.ai/api/v1"]));
    expect(new Set(stable.web)).toEqual(new Set(["https://try.puppyone.ai"]));
    expect(stable.web).toHaveLength(stable.api.length);
  });
});
