import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/** Acceptance requires the durable server result AND its rendered assistant reply. */
export async function cloudAgentLiveScenario(driver, report) {
  await driver.verifyEnvironment();
  report.steps.push("production-app-and-account");
  // A read-only missing receipt must be 404. A missing database migration is
  // typically 500; fail before creating an Agent/session or spending compute.
  await driver.probeReceipt(randomUUID());
  report.steps.push("durable-api-readable");
  await driver.selectWorkspace();
  await driver.selectLocation("local");
  await driver.openLocalAgent();
  await driver.selectLocation("cloud");
  await driver.assertClosed();
  await driver.openCloudAgent();
  report.steps.push("local-to-cloud-and-explicit-open");
  await driver.startEmptyChat();
  let sessionId;
  const runIds = new Set();
  // Return to Cloud twice and continue the SAME server session each time.
  for (let turn = 1; turn <= 3; turn++) {
    if (turn > 1) {
      await driver.selectLocation("local");
      await driver.assertClosed();
      await driver.selectLocation("cloud");
      await driver.assertClosed();
      await driver.openCloudAgent();
    }
    const marker = `PUPPYONE_CHAT_${randomUUID().replaceAll("-", "")}`;
    const run = await driver.sendAndReceive(marker);
    assert.equal(run.state, "succeeded", "Server must confirm successful completion");
    assert.ok(run.snapshot?.text?.includes(marker), "Server assistant reply must contain this turn's marker");
    assert.ok(run.session_id && run.id && run.request_id, "Admission must include durable identities");
    assert.equal(run.project_id, driver.projectId, "Run must belong to the selected project");
    assert.ok(!runIds.has(run.id), "Each turn must create one distinct run");
    runIds.add(run.id);
    sessionId ??= run.session_id;
    assert.equal(run.session_id, sessionId, "Switching location must preserve the server conversation");
    await driver.assertAssistantReply(run.id, marker);
    report.turns.push({ id: run.id, request_id: run.request_id, session_id: run.session_id, state: run.state });
    report.steps.push(`reply-${turn}-confirmed-and-rendered`);
  }
  await driver.assertSessionRuns(sessionId, [...runIds]);
  report.steps.push("three-turns-in-one-server-session");
}
