import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveCloudApiBaseUrl } from "../../../shared/cloudEndpoint.js";

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function atomicSave(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, content, { mode: 0o600, flag: "wx" });
    await fs.rename(temp, filePath);
    await fs.chmod(filePath, 0o600);
  } finally { await fs.unlink(temp).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
}

/** Main-process only. A lost registration reply retries with the SAME key. */
export function createDeviceIdentityService({ filePath, secureStorage, auth, apiBase }) {
  if (!secureStorage?.isEncryptionAvailable?.()) throw new Error("Device key storage is unavailable.");
  const deployment = resolveCloudApiBaseUrl(apiBase);
  let pending = Promise.resolve();

  async function load() {
    try {
      const records = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (!Array.isArray(records) || records.length > 32) throw new Error("Invalid device identities.");
      return records;
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async function forSession() {
    const session = await auth.readSession();
    if (!session || !UUID.test(session.user_id)) throw new Error("Sign in before registering a device.");
    if (session.api_base_url !== deployment) throw new Error("Cloud deployment changed.");
    return session;
  }

  async function registerUnserialized(name, platform, expectedSession) {
    const session = await forSession();
    if (expectedSession && (expectedSession.userId !== session.user_id ||
        expectedSession.generation !== session.session_generation)) throw new Error("Account changed before registration.");
    const accountId = session.user_id;
    const records = await load();
    let record = records.find((item) => item.deployment === deployment && item.accountId === accountId);
    if (record?.deviceId) return { deviceId: record.deviceId, accountId };
    if (!record) {
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
      const spki = publicKey.export({ format: "der", type: "spki" });
      if (!spki.subarray(0, SPKI_ED25519_PREFIX.length).equals(SPKI_ED25519_PREFIX)) {
        throw new Error("Unsupported device public key.");
      }
      record = { deployment, accountId,
        publicKey: spki.subarray(SPKI_ED25519_PREFIX.length).toString("base64"),
        encryptedPrivateKey: secureStorage.encryptString(privateKey.export({ format: "pem", type: "pkcs8" })).toString("base64"),
        deviceId: null };
      records.push(record);
      await atomicSave(filePath, JSON.stringify(records));
    }
    // The backend returns the same ID if the first response was lost. Never create
    // another key on transport errors or reuse an identity across accounts.
    const result = await auth.requestSessionApi(deployment, "/hosts/devices", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ public_key: record.publicKey, name, platform }),
    }, { userId: accountId, generation: session.session_generation });
    if (!UUID.test(result?.device_id)) throw new Error("Device registration returned an invalid ID.");
    const current = await forSession();
    if (current.user_id !== accountId || current.session_generation !== session.session_generation) {
      throw new Error("Account changed during registration.");
    }
    record.deviceId = result.device_id;
    await atomicSave(filePath, JSON.stringify(records));
    return { deviceId: record.deviceId, accountId };
  }

  return Object.freeze({
    async existingForCurrentAccount() {
      const session = await forSession();
      const record = (await load()).find((item) => item.deployment === deployment &&
        item.accountId === session.user_id && UUID.test(item.deviceId));
      return record ? { deviceId: record.deviceId, accountId: session.user_id } : null;
    },
    register(name, platform, expectedSession = null) {
      const result = pending.catch(() => {}).then(() => registerUnserialized(name, platform, expectedSession));
      pending = result;
      return result;
    },
    async signForCurrentAccount(deviceId, payload) {
      const accountId = (await forSession()).user_id;
      const record = (await load()).find((item) => item.deployment === deployment &&
        item.accountId === accountId && item.deviceId === deviceId);
      if (!record) throw new Error("This device is not registered to the current account.");
      const privateKey = crypto.createPrivateKey(secureStorage.decryptString(Buffer.from(record.encryptedPrivateKey, "base64")));
      return crypto.sign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64");
    },
  });
}
