import { PNG } from "pngjs";

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function decodeAppIconPng(contents, size, label) {
  // Bound allocation before decoding; checking only the signature misses broken PNGs.
  if (contents.length < 33 || !contents.subarray(0, 8).equals(signature)
    || contents.toString("ascii", 12, 16) !== "IHDR"
    || contents.readUInt32BE(16) !== size || contents.readUInt32BE(20) !== size) {
    throw new Error(`${label} must be a ${size} x ${size} PNG.`);
  }
  try {
    return PNG.sync.read(contents, { checkCRC: true });
  } catch (cause) {
    throw new Error(`${label} is not a decodable PNG.`, { cause });
  }
}
