#!/usr/bin/env node
/**
 * Desktop's own first-push code against a running Cloud.
 *
 * The backend's owned Docker runner mounts this checkout read-only and calls
 * this driver (puppyone-cloud scripts/testing/run_repository_hosting.py
 * --docker --live --s3 --desktop <checkout>). It reads one JSON request on
 * stdin and prints one JSON result.
 *
 * Everything that decides what reaches Cloud is Desktop's production code: the
 * coordinator, journal, Cloud publish API and canonical-remote check, the Git
 * service and runner, the operation-receipt reader and the HTTP client. Only
 * the OS keychain is replaced: the generated Git credential stays in memory
 * and reaches Git as a header scoped to the canonical remote, which is what
 * the keychain helper would answer. No npm package is loaded.
 */
import crypto from "node:crypto";
import { createCloudPublishCoordinator } from "../../../electron/main/cloud-publish-coordinator.mjs";
import { requestCloudApi } from "../../../electron/main/cloud-api-client.mjs";
import { execGit } from "../../../electron/local-api/git/runner.mjs";

async function readRequest() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  for (const key of ["apiBaseUrl", "accessToken", "userId", "organizationId", "rootPath", "projectName", "sourceBranch"]) {
    if (typeof request[key] !== "string" || !request[key]) throw new Error(`driver request needs ${key}`);
  }
  return request;
}

function keychainStandIn() {
  const credentials = new Map();
  return {
    prepare: async (_rootPath, remoteUrl) => ({
      version: 1,
      scope_url: new URL(remoteUrl).toString(),
      helper: "libsecret",
      previous_helpers: [],
      previous_use_http_path: [],
    }),
    approve: async (_rootPath, remoteUrl, username, secret) => {
      credentials.set(remoteUrl, `Basic ${Buffer.from(`${username}:${secret}`).toString("base64")}`);
      return { rollback: async () => undefined };
    },
    assertManaged: async () => undefined,
    cleanupManaged: async () => undefined,
    commandArgs: (remoteUrl, _snapshot, args) => {
      const authorization = credentials.get(remoteUrl);
      return authorization ? ["-c", `http.${remoteUrl}.extraHeader=Authorization: ${authorization}`, ...args] : args;
    },
  };
}

const request = await readRequest();
// What electron/cloud-auth-service.mjs adds to every session request.
const cloudAuthService = {
  readSession: async () => ({ user_id: request.userId, api_base_url: request.apiBaseUrl, status: "authenticated" }),
  requestSessionApi: (apiBase, apiPath, init = {}) => requestCloudApi(apiBase, apiPath, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers, Authorization: `Bearer ${request.accessToken}` },
  }),
};
const vault = new Map();
const coordinator = createCloudPublishCoordinator({
  cloudAuthService,
  secretVault: {
    createRef: () => crypto.randomUUID(),
    put: async (ref, secret) => { vault.set(ref, secret); },
    get: async (ref) => vault.get(ref) ?? null,
    clear: async (ref) => { vault.delete(ref); },
  },
  gitCredentialManager: keychainStandIn(),
});

const result = await coordinator.startOrResume({
  rootPath: request.rootPath,
  apiBaseUrl: request.apiBaseUrl,
  userId: request.userId,
  organizationId: request.organizationId,
  projectName: request.projectName,
  sourceBranch: request.sourceBranch,
  action: "initialize",
});
const remote = await execGit(request.rootPath, ["remote", "get-url", "puppyone"]).then(
  ({ stdout }) => stdout.trim(), () => null);
const upstream = await execGit(request.rootPath, ["rev-parse", "--abbrev-ref", `${request.sourceBranch}@{upstream}`]).then(
  ({ stdout }) => stdout.trim(), () => null);
process.stdout.write(`${JSON.stringify({ ...result, gitStatus: undefined, remote, upstream })}\n`);
