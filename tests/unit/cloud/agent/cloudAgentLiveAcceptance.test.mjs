import { describe, expect, it, vi } from "vitest";
import { cloudAgentLiveScenario } from "../../../support/cloud/cloudAgentLiveScenario.mjs";

// These verify the acceptance gate's failure rules, not live server behavior.
function fixture() {
  let count = 0;
  const report = { steps: [], turns: [] };
  const driver = {
    projectId: "project", verifyEnvironment: vi.fn(), probeReceipt: vi.fn(), selectWorkspace: vi.fn(),
    selectLocation: vi.fn(), openLocalAgent: vi.fn(), assertClosed: vi.fn(), openCloudAgent: vi.fn(),
    startEmptyChat: vi.fn(), assertAssistantReply: vi.fn(), assertSessionRuns: vi.fn(),
    sendAndReceive: vi.fn(async marker => ({ id: `run-${++count}`, request_id: `request-${count}`,
      project_id: "project", session_id: "session", state: "succeeded", snapshot: { text: marker } })),
  };
  return { driver, report };
}
describe("live Cloud Agent acceptance gate", () => {
  it("fails on a real API/storage outage before sending messages or changing workspace", async () => {
    const { driver, report } = fixture();
    driver.probeReceipt.mockRejectedValue(Object.assign(new Error("Internal Server Error"), { status: 500 }));
    await expect(cloudAgentLiveScenario(driver, report)).rejects.toMatchObject({ status: 500 });
    expect(driver.selectWorkspace).not.toHaveBeenCalled();
    expect(driver.sendAndReceive).not.toHaveBeenCalled();
    expect(report.steps).toEqual(["production-app-and-account"]);
  });
  it("requires three replies with two location returns in the same server session", async () => {
    const { driver, report } = fixture();
    await cloudAgentLiveScenario(driver, report);
    expect(driver.selectLocation.mock.calls.map(([name]) => name)).toEqual(["local", "cloud", "local", "cloud", "local", "cloud"]);
    expect(driver.openCloudAgent).toHaveBeenCalledTimes(3);
    expect(driver.assertAssistantReply).toHaveBeenCalledTimes(3);
    expect(driver.assertSessionRuns).toHaveBeenCalledWith("session", ["run-1", "run-2", "run-3"]);
    expect(report.turns).toHaveLength(3);
  });
  it.each([
    { state: "failed" }, { state: "running" }, { snapshot: { text: "" } },
    { project_id: "other-project" }, { session_id: "" }, { request_id: "" },
  ])("rejects incomplete or misrouted server results: %j", async result => {
    const { driver, report } = fixture();
    driver.sendAndReceive.mockImplementation(async marker => ({ id: "run", request_id: "request",
      project_id: "project", session_id: "session", state: "succeeded", snapshot: { text: marker }, ...result }));
    await expect(cloudAgentLiveScenario(driver, report)).rejects.toThrow();
    expect(driver.assertSessionRuns).not.toHaveBeenCalled();
  });
  it("rejects replies that resume into a different server conversation", async () => {
    const { driver, report } = fixture();
    let turn = 0;
    driver.sendAndReceive.mockImplementation(async marker => ({ id: `run-${++turn}`, request_id: `request-${turn}`,
      project_id: "project", session_id: `session-${turn}`, state: "succeeded", snapshot: { text: marker } }));
    await expect(cloudAgentLiveScenario(driver, report)).rejects.toThrow("preserve the server conversation");
    expect(report.turns).toHaveLength(1);
  });
  it("cannot pass just because the prompt marker is present in the user bubble", async () => {
    const { driver, report } = fixture();
    driver.assertAssistantReply.mockRejectedValue(new Error("No assistant bubble"));
    await expect(cloudAgentLiveScenario(driver, report)).rejects.toThrow("No assistant bubble");
    expect(report.turns).toEqual([]);
  });
});
