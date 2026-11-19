/**
 * The small part of the OpenSSH wire formats the host and its clients need:
 * Ed25519 keys and Ed25519 user certificates (PROTOCOL.certkeys). ssh2 does not
 * verify certificates, so the host does it here, against the Cloud's
 * certificate authority, and the client presents one through this module.
 */
import crypto from "node:crypto";

export const ED25519 = "ssh-ed25519";
export const ED25519_CERT = "ssh-ed25519-cert-v01@openssh.com";
const USER_CERTIFICATE = 1;
// Extensions a user certificate may carry; anything else is ignored, as OpenSSH does.
const MAX_CERTIFICATE_BYTES = 16 * 1024;

const u32 = (value) => { const out = Buffer.alloc(4); out.writeUInt32BE(value); return out; };
const sshString = (value) => { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8"); return Buffer.concat([u32(bytes.length), bytes]); };

class Reader {
  constructor(buffer) { this.buffer = buffer; this.offset = 0; }
  bytes(length) {
    if (this.offset + length > this.buffer.length) throw new Error("Truncated SSH data.");
    const out = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }
  u32() { return this.bytes(4).readUInt32BE(0); }
  u64() { return this.bytes(8).readBigUInt64BE(0); }
  string() { return this.bytes(this.u32()); }
  text() { return this.string().toString("utf8"); }
  done() { return this.offset === this.buffer.length; }
}

function strings(buffer) {
  const reader = new Reader(buffer);
  const out = [];
  while (!reader.done()) out.push(reader.text());
  return out;
}

function base64url(buffer) { return Buffer.from(buffer).toString("base64url"); }

export function ed25519PublicBlob(raw) {
  if (raw.length !== 32) throw new Error("Not an Ed25519 public key.");
  return Buffer.concat([sshString(ED25519), sshString(raw)]);
}

export function openSshPublicKey(raw, comment = "") {
  return `${ED25519} ${ed25519PublicBlob(raw).toString("base64")}${comment ? ` ${comment}` : ""}`;
}

/** "ssh-ed25519 AAAA… [comment]" or an Ed25519 certificate line -> its wire blob. */
export function parsePublicKeyLine(line, expectedType = ED25519) {
  const [type, data] = String(line ?? "").trim().split(/\s+/);
  if (type !== expectedType || !data) throw new Error(`Expected an ${expectedType} key.`);
  const blob = Buffer.from(data, "base64");
  if (new Reader(blob).text() !== type) throw new Error("SSH key type mismatch.");
  return blob;
}

export function rawEd25519PublicKey(blob) {
  const reader = new Reader(blob);
  if (reader.text() !== ED25519) throw new Error("Not an Ed25519 key.");
  const raw = reader.string();
  if (raw.length !== 32 || !reader.done()) throw new Error("Not an Ed25519 key.");
  return raw;
}

/** Ed25519 raw keys of a Node KeyObject (private), via JWK. */
export function ed25519Raw(privateKey) {
  const jwk = privateKey.export({ format: "jwk" });
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519") throw new Error("Not an Ed25519 key.");
  return { seed: Buffer.from(jwk.d, "base64url"), publicKey: Buffer.from(jwk.x, "base64url") };
}

export function ed25519PublicKeyObject(raw) {
  return crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: base64url(raw) }, format: "jwk" });
}

/** An unencrypted openssh-key-v1 private key, kept in memory only (never written). */
export function openSshPrivateKey(privateKey, comment = "") {
  const { seed, publicKey } = ed25519Raw(privateKey);
  const check = crypto.randomBytes(4);
  let secret = Buffer.concat([check, check, sshString(ED25519), sshString(publicKey),
    sshString(Buffer.concat([seed, publicKey])), sshString(comment)]);
  const padding = (8 - (secret.length % 8)) % 8;
  secret = Buffer.concat([secret, Buffer.from(Array.from({ length: padding }, (_, index) => index + 1))]);
  const body = Buffer.concat([Buffer.from("openssh-key-v1\0", "binary"), sshString("none"), sshString("none"),
    sshString(Buffer.alloc(0)), u32(1), sshString(ed25519PublicBlob(publicKey)), sshString(secret)]);
  const lines = body.toString("base64").match(/.{1,70}/g).join("\n");
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

/** Parses an Ed25519 user or host certificate blob; verifies nothing. */
export function parseCertificate(blob) {
  if (!Buffer.isBuffer(blob) || blob.length > MAX_CERTIFICATE_BYTES) throw new Error("Invalid certificate.");
  const reader = new Reader(blob);
  if (reader.text() !== ED25519_CERT) throw new Error("Not an Ed25519 certificate.");
  reader.string(); // nonce
  const publicKey = reader.string();
  if (publicKey.length !== 32) throw new Error("Invalid certificate key.");
  const serial = reader.u64();
  const type = reader.u32();
  const keyId = reader.text();
  const principals = strings(reader.string());
  const validAfter = reader.u64();
  const validBefore = reader.u64();
  const criticalOptions = reader.string();
  const extensions = reader.string();
  reader.string(); // reserved
  const signatureKey = reader.string();
  const signedLength = reader.offset;
  const signature = reader.string();
  if (!reader.done()) throw new Error("Invalid certificate.");
  return { publicKey, serial, type, keyId, principals, validAfter, validBefore,
    criticalOptions: optionNames(criticalOptions), extensions: optionNames(extensions),
    signatureKey, signature, signed: blob.subarray(0, signedLength) };
}

function optionNames(buffer) {
  const reader = new Reader(buffer);
  const names = [];
  while (!reader.done()) { names.push(reader.text()); reader.string(); }
  return names;
}

/** An Ed25519 signature blob ("ssh-ed25519", 64 bytes) or the raw 64 bytes. */
export function rawSignature(signature) {
  if (signature.length === 64) return signature;
  const reader = new Reader(signature);
  if (reader.text() !== ED25519) throw new Error("Unsupported signature.");
  const raw = reader.string();
  if (raw.length !== 64 || !reader.done()) throw new Error("Unsupported signature.");
  return raw;
}

export function verifyEd25519(rawPublicKey, data, signature) {
  try {
    return crypto.verify(null, data, ed25519PublicKeyObject(rawPublicKey), rawSignature(signature));
  } catch { return false; }
}

/**
 * Accepts only a user certificate signed by one of `authorities` (public key
 * blobs), naming `principal`, valid now, with no critical options. Returns the
 * certificate; throws a reason otherwise.
 */
export function verifyUserCertificate(blob, { authorities, principal, now = Date.now() }) {
  const certificate = parseCertificate(blob);
  if (certificate.type !== USER_CERTIFICATE) throw new Error("Not a user certificate.");
  if (!authorities.some((authority) => authority.equals(certificate.signatureKey))) throw new Error("Unknown certificate authority.");
  if (!verifyEd25519(rawEd25519PublicKey(certificate.signatureKey), certificate.signed, certificate.signature)) {
    throw new Error("Invalid certificate signature.");
  }
  const seconds = BigInt(Math.floor(now / 1000));
  if (seconds < certificate.validAfter || seconds >= certificate.validBefore) throw new Error("Certificate is not valid now.");
  if (!certificate.principals.includes(principal)) throw new Error("Certificate is for another computer.");
  // force-command, source-address and the like are not honoured here, so refuse them.
  if (certificate.criticalOptions.length) throw new Error("Unsupported certificate options.");
  return certificate;
}

/**
 * The client side: an ssh2 key that authenticates with a certificate. ssh2
 * sends `getPublicSSH()` as the public key and signs with the private key.
 */
export function certificateKey(parsedPrivateKey, certificateLine) {
  const blob = parsePublicKeyLine(certificateLine, ED25519_CERT);
  const key = Object.create(parsedPrivateKey);
  Object.defineProperty(key, "type", { value: ED25519_CERT });
  key.getPublicSSH = () => blob;
  return key;
}
