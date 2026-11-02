import { describe, expect, it } from "vitest";
import { validateCanonicalCloudGitRemoteUrl } from "../../../../electron/main/cloud-publish-api.mjs";

const projectId = "11111111-1111-4111-8111-111111111111";
const remote = (origin) => `${origin}/git/${projectId}.git`;
const validate = (remoteUrl, apiBaseUrl, configuredGitOrigin = null) =>
  validateCanonicalCloudGitRemoteUrl(remoteUrl, { projectId, apiBaseUrl, configuredGitOrigin });

describe("the Git remote a first publish writes", () => {
  it.each([
    ["production", "https://api.puppyone.ai"],
    ["Qubits", "https://qubits-api.puppyone.ai"],
  ])("accepts the paired %s Cloud's own origin", (_name, origin) => {
    expect(validate(remote(origin), `${origin}/api/v1`)).toBe(remote(origin));
  });

  it.each([
    ["a Qubits app given a production remote", "https://api.puppyone.ai", "https://qubits-api.puppyone.ai/api/v1"],
    ["a production app given a Qubits remote", "https://qubits-api.puppyone.ai", "https://api.puppyone.ai/api/v1"],
    ["a sibling puppyone.ai host", "https://git.puppyone.ai", "https://api.puppyone.ai/api/v1"],
  ])("rejects %s: another environment's remote would link a Cloud this app cannot open", (_name, origin, api) => {
    expect(() => validate(remote(origin), api)).toThrow(/outside the trusted Cloud origin/);
  });

  it("uses a configured HTTPS Git origin only for loopback API development", () => {
    expect(validate(remote("https://api.puppyone.ai"), "http://localhost:9090/api/v1", "https://api.puppyone.ai"))
      .toBe(remote("https://api.puppyone.ai"));
    expect(() => validate(remote("https://api.puppyone.ai"), "https://qubits-api.puppyone.ai/api/v1", "https://api.puppyone.ai"))
      .toThrow(/outside the trusted Cloud origin/);
    expect(() => validate(remote("http://git.example.test"), "http://localhost:9090/api/v1", "http://git.example.test"))
      .toThrow(/unsafe Git remote|outside the trusted Cloud origin/);
  });

  it("still requires the canonical project path", () => {
    expect(() => validate("https://api.puppyone.ai/git/other.git", "https://api.puppyone.ai/api/v1")).toThrow(/unsafe Git remote/);
  });
});
