import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const TOKEN_PATTERN = /^(?:WKS|IMG|EXT)_[A-F0-9]{8,24}$/u;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const GLYPHS = Object.freeze({
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  _: ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
});

export function createNativeReferenceSmokeTokens() {
  const suffix = randomBytes(6).toString("hex").toUpperCase();
  return Object.freeze({
    workspace: `WKS_${suffix}`,
    image: `IMG_${suffix}`,
    externalText: `EXT_${suffix}`,
  });
}

export async function createNativeReferenceSmokeFixtures({ workspaceRoot, attachmentRoot, tokens }) {
  const normalized = normalizeTokens(tokens);
  const workspaceDirectory = path.join(workspaceRoot, ".puppyone-reference-smoke");
  await fs.promises.mkdir(workspaceDirectory, { recursive: true, mode: 0o700 });
  await fs.promises.mkdir(attachmentRoot, { recursive: true, mode: 0o700 });

  const workspacePath = path.join(workspaceDirectory, "workspace-context.txt");
  const imagePath = path.join(attachmentRoot, "visual-context.png");
  const externalTextPath = path.join(attachmentRoot, "external-context.txt");
  const unsupportedPath = path.join(attachmentRoot, "unsupported-document.pdf");
  const unsupportedVideoPath = path.join(attachmentRoot, "unsupported-video.mp4");
  await fs.promises.writeFile(workspacePath, `${normalized.workspace}\n`, { mode: 0o600 });
  await fs.promises.writeFile(imagePath, renderTokenPng(normalized.image), { mode: 0o600 });
  await fs.promises.writeFile(externalTextPath, `${normalized.externalText}\n`, { mode: 0o600 });
  await fs.promises.writeFile(unsupportedPath, "%PDF-1.4\n% PuppyOne unsupported reference smoke\n", { mode: 0o600 });
  await fs.promises.writeFile(unsupportedVideoPath, Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]), { mode: 0o600 });

  const [workspaceStat, imageStat, externalTextStat, unsupportedStat, unsupportedVideoStat] = await Promise.all([
    fs.promises.stat(workspacePath),
    fs.promises.stat(imagePath),
    fs.promises.stat(externalTextPath),
    fs.promises.stat(unsupportedPath),
    fs.promises.stat(unsupportedVideoPath),
  ]);
  return Object.freeze({
    tokens: normalized,
    workspace: authorizedReference({
      id: "smoke-workspace-text",
      kind: "workspace-entry",
      entryType: "file",
      filePath: workspacePath,
      displayName: "workspace-context.txt",
      relativePath: ".puppyone-reference-smoke/workspace-context.txt",
      mime: "text/plain",
      size: workspaceStat.size,
    }),
    image: authorizedReference({
      id: "smoke-staged-image",
      kind: "staged-attachment",
      filePath: imagePath,
      displayName: "visual-context.png",
      mime: "image/png",
      size: imageStat.size,
    }),
    externalText: authorizedReference({
      id: "smoke-staged-text",
      kind: "staged-attachment",
      filePath: externalTextPath,
      displayName: "external-context.txt",
      mime: "text/plain",
      size: externalTextStat.size,
    }),
    unsupported: authorizedReference({
      id: "smoke-unsupported-pdf",
      kind: "staged-attachment",
      filePath: unsupportedPath,
      displayName: "unsupported-document.pdf",
      mime: "application/pdf",
      size: unsupportedStat.size,
    }),
    unsupportedVideo: authorizedReference({
      id: "smoke-unsupported-video",
      kind: "staged-attachment",
      filePath: unsupportedVideoPath,
      displayName: "unsupported-video.mp4",
      mime: "video/mp4",
      size: unsupportedVideoStat.size,
    }),
  });
}

export function renderTokenPng(token, { scale = 5, padding = 12 } = {}) {
  if (!TOKEN_PATTERN.test(token) || !Number.isSafeInteger(scale) || scale < 2 || scale > 12) {
    throw new TypeError("Native reference smoke image token is invalid.");
  }
  const width = padding * 2 + token.length * 6 * scale - scale;
  const height = padding * 2 + 7 * scale;
  const stride = width + 1;
  const raw = Buffer.alloc(stride * height, 255);
  for (let y = 0; y < height; y += 1) raw[y * stride] = 0;

  for (let index = 0; index < token.length; index += 1) {
    const glyph = GLYPHS[token[index]];
    if (!glyph) throw new TypeError("Native reference smoke image token contains an unsupported glyph.");
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] !== "1") continue;
        for (let dy = 0; dy < scale; dy += 1) {
          const y = padding + row * scale + dy;
          for (let dx = 0; dx < scale; dx += 1) {
            const x = padding + index * 6 * scale + column * scale + dx;
            raw[y * stride + 1 + x] = 0;
          }
        }
      }
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function authorizedReference({ id, kind, entryType, filePath, displayName, relativePath, mime, size }) {
  return Object.freeze({
    id,
    kind,
    ...(entryType ? { entryType } : {}),
    authorized: true,
    path: filePath,
    name: displayName,
    displayName,
    ...(relativePath ? { relativePath } : {}),
    mime,
    size,
  });
}

function normalizeTokens(tokens) {
  const values = {
    workspace: tokens?.workspace,
    image: tokens?.image,
    externalText: tokens?.externalText,
  };
  if (!Object.values(values).every((value) => typeof value === "string" && TOKEN_PATTERN.test(value))) {
    throw new TypeError("Native reference smoke tokens are invalid.");
  }
  return Object.freeze(values);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
