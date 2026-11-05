import { afterEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDeviceIdentityService } from "../../../../electron/main/hosts/device-identity.mjs";

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
const accountA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const accountB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const deviceA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const deviceB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const apiBase = "https://api.puppyone.ai/api/v1";
const secureStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`cipher:${value}`),
  decryptString: (bytes) => bytes.toString().slice("cipher:".length),
};

async function setup() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-device-identity-")));
  roots.push(root);
  let accountId = accountA;
  let generation = "one";
  let loseReply = true;
  const calls = [];
  const auth = {
    readSession: async () => ({ user_id: accountId, api_base_url: apiBase, session_generation: generation }),
    async requestSessionApi(base, route, request, expected) {
      const key = JSON.parse(request.body).public_key;
      calls.push({ base, route, key, expected });
      if (loseReply) { loseReply = false; throw new Error("lost response"); }
      return { device_id: accountId === accountA ? deviceA : deviceB };
    },
  };
  return { root, auth, calls, changeAccount: () => { accountId = accountB; generation = "two"; } };
}

describe("device identity", () => {
  it("refuses Linux plaintext fallback even when the storage API reports availability", async () => {
    const { root, auth } = await setup();
    expect(() => createDeviceIdentityService({ filePath: path.join(root, "device.json"), auth, apiBase,
      secureStorage: { ...secureStorage, getSelectedStorageBackend: () => "basic_text" } })).toThrow("storage is unavailable");
  });
  it("persists one encrypted private key before request and retries with the same public key", async () => {
    const { root, auth, calls } = await setup();
    const filePath = path.join(root, "device.json");
    const service = createDeviceIdentityService({ filePath, secureStorage, auth, apiBase });
    await expect(service.register("Mac", "darwin")).rejects.toThrow("lost response");
    expect(JSON.stringify(JSON.parse(await fs.readFile(filePath, "utf8")))).not.toContain("BEGIN PRIVATE KEY");
    expect((await service.register("Mac", "darwin")).deviceId).toBe(deviceA);
    expect(calls).toHaveLength(2);
    expect(calls[0].key).toBe(calls[1].key);
    expect(calls[1].expected).toEqual({ userId: accountA, generation: "one" });
    const signature = await service.signForCurrentAccount(deviceA, "challenge");
    const publicKey = crypto.createPublicKey({ key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(calls[0].key, "base64")]),
      format: "der", type: "spki" });
    expect(crypto.verify(null, Buffer.from("challenge"), publicKey, Buffer.from(signature, "base64"))).toBe(true);
    expect(await service.register("Mac", "darwin")).toEqual({ deviceId: deviceA, accountId: accountA });
    expect(calls).toHaveLength(2);
  });

  it("does not reuse another account's identity", async () => {
    const { root, auth, calls, changeAccount } = await setup();
    const service = createDeviceIdentityService({ filePath: path.join(root, "device.json"), secureStorage, auth, apiBase });
    await expect(service.register("Mac", "darwin")).rejects.toThrow();
    await service.register("Mac", "darwin");
    changeAccount();
    await expect(service.signForCurrentAccount(deviceA, "challenge")).rejects.toThrow();
    await service.register("Mac", "darwin");
    expect(calls[2].key).not.toBe(calls[0].key);
  });
});
