import { describe, expect, it } from "vitest";
import { cloudSandboxContributions, readCloudSandbox } from "../../../../src/features/cloud/sandbox/cloudSandboxFeatures";
import { cloudScreenAvailability } from "../../../../src/features/cloud/sandbox/cloudScreenState";

const feature = (id: string, changes: Record<string, unknown> = {}) => ({
  id, surface: id === "screen_stream" ? "screen" : null, transport: id === "screen_stream" ? "vnc" : null,
  installed: true, enabled: true, reason: null, preview: false, ...changes,
});

const sandbox = (changes: Record<string, unknown> = {}, screen: Record<string, unknown> = {}) => readCloudSandbox({
  profile: "desktop", next_profile: "desktop", settings: {},
  features: [feature("desktop"), feature("screen_stream", screen), feature("browser"),
    feature("from_a_newer_server", { surface: "panel" })],
  ...changes,
});

describe("Cloud sandbox Feature registry", () => {
  it("reads servers before Profiles and malformed rows as no Features", () => {
    expect(readCloudSandbox(undefined)).toEqual({ profile: null, next_profile: null, settings: {}, features: [] });
    expect(readCloudSandbox({ profile: 3, settings: { desktop: "yes", screen_stream: false, isolated_agent_sandboxes: true }, features: [{ id: 1 }, null] }))
      .toEqual({ profile: null, next_profile: null, settings: { screen_stream: false, isolated_agent_sandboxes: true }, features: [] });
  });

  it("places an enabled Feature in its slots and ignores Features it does not know", () => {
    expect(cloudSandboxContributions(sandbox()).map(item => item.feature)).toEqual(["screen_stream"]);
    expect(cloudSandboxContributions(sandbox({}, { enabled: false, reason: "user_disabled" }))).toEqual([]);
  });
});

describe("Cloud screen availability", () => {
  it("streams with the transport the server names", () => {
    expect(cloudScreenAvailability(sandbox())).toEqual({ kind: "stream", transport: "vnc" });
  });

  it("offers to install a desktop, or says it is coming with the next computer", () => {
    const base = { profile: "base", features: [feature("screen_stream", { installed: false, enabled: false, reason: "not_installed" })] };
    expect(cloudScreenAvailability(sandbox({ ...base, next_profile: "base" }))).toEqual({ kind: "install", pending: false });
    expect(cloudScreenAvailability(sandbox({ ...base, next_profile: "desktop" }))).toEqual({ kind: "install", pending: true });
    expect(cloudScreenAvailability(readCloudSandbox(undefined))).toEqual({ kind: "install", pending: false });
  });

  it("distinguishes the owner's toggle from other refusals and from layout previews", () => {
    expect(cloudScreenAvailability(sandbox({}, { enabled: false, reason: "user_disabled" }))).toEqual({ kind: "stream_off" });
    expect(cloudScreenAvailability(sandbox({}, { enabled: false, reason: "disabled" }))).toEqual({ kind: "unavailable" });
    expect(cloudScreenAvailability(sandbox({}, { preview: true }))).toEqual({ kind: "preview" });
  });
});
