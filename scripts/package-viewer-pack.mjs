#!/usr/bin/env node
/**
 * Package a Viewer Pack directory into a signed `.puppyplugin` + `.sig`.
 *
 * Usage:
 *   node scripts/package-viewer-pack.mjs \
 *     --source tests/fixtures/extensions/viewer-packs/glb \
 *     --out artifacts/viewer-packs/ai.puppyone.viewer.glb-1.0.0.puppyplugin \
 *     --generate-test-key
 */

import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import {
  createPackageSignatureEnvelope,
  generateTestKeyPair,
  sha256Hex,
  serializePackageSignatureEnvelope,
} from "../electron/main/viewer-packs/package-signature.mjs";
import { validateViewerPackManifest } from "../electron/main/viewer-packs/manifest-schema.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = {
    source: null,
    out: null,
    privateKeyPemPath: null,
    generateTestKey: false,
    keyId: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--source") args.source = argv[++i];
    else if (token === "--out") args.out = argv[++i];
    else if (token === "--private-key-pem") args.privateKeyPemPath = argv[++i];
    else if (token === "--generate-test-key") args.generateTestKey = true;
    else if (token === "--key-id") args.keyId = argv[++i];
  }
  return args;
}

async function collectFiles(rootDir, relative = "") {
  const abs = path.join(rootDir, relative);
  const entries = await fsp.readdir(abs, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await collectFiles(rootDir, nextRelative));
    } else if (entry.isFile()) {
      files.push(nextRelative.replace(/\\/g, "/"));
    }
  }
  return files;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source || !args.out) {
    console.error("Usage: node scripts/package-viewer-pack.mjs --source <dir> --out <file.puppyplugin> (--private-key-pem <path> --key-id <id> | --generate-test-key)");
    process.exit(2);
  }

  const sourceDir = path.resolve(repoRoot, args.source);
  const outPath = path.resolve(repoRoot, args.out);
  const files = await collectFiles(sourceDir);
  if (!files.includes("manifest.json")) {
    throw new Error("manifest.json is required at the pack root.");
  }
  const manifestRaw = JSON.parse(await fsp.readFile(path.join(sourceDir, "manifest.json"), "utf8"));
  const validatedManifest = validateViewerPackManifest(manifestRaw);
  if (!validatedManifest.ok) {
    throw new Error(`Invalid Viewer Pack manifest: ${validatedManifest.errors.join(", ")}`);
  }

  const zip = new JSZip();
  for (const relative of files.sort()) {
    const bytes = await fsp.readFile(path.join(sourceDir, relative));
    zip.file(relative, bytes);
  }
  const archiveBytes = Buffer.from(await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  }));

  let privateKeyPem = process.env.PUPPYONE_VIEWER_PACK_PRIVATE_KEY_PEM ?? null;
  let publicKeyPem = null;
  let keyId = args.keyId ?? process.env.PUPPYONE_VIEWER_PACK_KEY_ID ?? null;
  if (args.privateKeyPemPath) {
    privateKeyPem = await fsp.readFile(path.resolve(repoRoot, args.privateKeyPemPath), "utf8");
  }
  if (args.generateTestKey) {
    const pair = generateTestKeyPair();
    privateKeyPem = pair.privateKeyPem;
    publicKeyPem = pair.publicKeyPem;
    keyId = keyId ?? "puppyone-test-local";
  }
  if (!privateKeyPem || !keyId) {
    throw new Error("A private signing key and --key-id are required; test keys are generated only with --generate-test-key.");
  }

  const signatureEnvelope = createPackageSignatureEnvelope({
    privateKeyPem,
    payloadBytes: archiveBytes,
    keyId,
    publisher: validatedManifest.value.publisher,
  });
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(outPath, archiveBytes);
  await fsp.writeFile(`${outPath}.sig`, serializePackageSignatureEnvelope(signatureEnvelope), "utf8");
  if (publicKeyPem) {
    await fsp.writeFile(`${outPath}.test-public-key.txt`, publicKeyPem, "utf8");
  }

  console.log(JSON.stringify({
    out: outPath,
    signature: `${outPath}.sig`,
    sha256: sha256Hex(archiveBytes),
    bytes: archiveBytes.length,
    files: files.length,
    keyId,
    publisher: validatedManifest.value.publisher,
    testPublicKey: publicKeyPem ? `${outPath}.test-public-key.txt` : null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
