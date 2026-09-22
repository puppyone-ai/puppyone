#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import electron from "electron";

const repository = path.resolve(import.meta.dirname, "../../..");
const phaseScript = path.join(repository, "tests/integration/model-connections/runtime/model-connections-restart.phase.mjs");
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-model-connections-restart-"));
const profile = path.join(fixture, "profile");
const workspace = path.join(fixture, "workspace");
const stateFile = path.join(fixture, "restart-state.json");
const secret = "synthetic-restart-private-key";
await fs.mkdir(workspace);

let metadataReads = 0;
let inferenceRequests = 0;
let serverFailure = null;
const server = http.createServer((request, response) => {
  if (request.headers.authorization !== `Bearer ${secret}`) {
    serverFailure = new Error("Restarted process did not recover the encrypted API Key.");
    response.writeHead(401).end();
    return;
  }
  if (request.url === "/v1/models") {
    metadataReads++;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: [{ id: "restart-model" }] }));
    return;
  }
  if (request.url !== "/v1/chat/completions") {
    serverFailure = new Error(`Unexpected model request: ${request.url}`);
    response.writeHead(404).end();
    return;
  }
  let raw = "";
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", () => {
    try {
      inferenceRequests++;
      const body = JSON.parse(raw);
      const verification = body.tools?.some((tool) => tool.function?.name === "puppyone_connection_check");
      const toolCall = verification && !body.messages.some((message) => message.role === "tool");
      const delta = toolCall
        ? { tool_calls: [{ index: 0, id: "restart_check", type: "function", function: { name: "puppyone_connection_check", arguments: '{"token":"puppyone-model-check"}' } }] }
        : { content: "Restarted model connection works." };
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ id: "restart", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: "restart", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: toolCall ? "tool_calls" : "stop" }] })}\n\n`);
      response.end("data: [DONE]\n\n");
    } catch (error) {
      serverFailure = error;
      response.destroy(error);
    }
  });
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

async function runPhase(phase) {
  const args = [phaseScript, `--phase=${phase}`, `--profile=${profile}`, `--workspace=${workspace}`, `--state=${stateFile}`, `--base-url=${baseUrl}`];
  const child = spawn(electron, args, {
    cwd: repository,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exit = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Model connection restart ${phase} phase timed out.\n${stdout}\n${stderr}`));
    }, 60_000);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`Model connection restart ${phase} phase failed (${code ?? signal}).\n${stdout}\n${stderr}`));
    });
  });
  await exit;
  assert.match(stdout, new RegExp(`MODEL_CONNECTION_RESTART_PHASE ${phase} ok`));
}

let failed = false;
try {
  await runPhase("write");
  assert.equal(metadataReads, 1, "First launch saves the connection and loads its catalog once.");
  assert.equal(inferenceRequests, 3, "First launch performs two explicit verification requests and one user turn.");
  await runPhase("read");
  if (serverFailure) throw serverFailure;
  assert.equal(metadataReads, 2, "Second launch reloads the model catalog from the persisted connection.");
  assert.equal(inferenceRequests, 4, "Second launch performs a user turn without re-entering the API Key.");
  console.log(JSON.stringify({ ok: true, twoElectronProcesses: true, encryptedCredentialRecovered: true,
    connectionRecovered: true, verificationRecovered: true, conversationRecovered: true,
    agentTurnAfterRestart: true, plaintextCredentialOnDisk: false, metadataReads, inferenceRequests }));
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(fixture, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;
