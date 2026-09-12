import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ZipPreflightError,
  preflightOoxmlPackage,
  preflightZipCentralDirectory,
  type ZipPreflightErrorCode,
} from "../../../../../packages/shared-ui/src/editor/security/zipCentralDirectoryPreflight";

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

type TestZipEntry = {
  name: string;
  compressedBytes?: number;
  uncompressedBytes?: number;
  compressionMethod?: number;
  flags?: number;
  centralExtra?: Uint8Array;
  localExtra?: Uint8Array;
};

describe("preflightZipCentralDirectory", () => {
  it("accepts the committed Word and Excel OOXML fixtures", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
    for (const filename of ["puppyone-preview-sample.docx", "puppyone-preview-sample.xlsx"]) {
      const bytes = readFileSync(path.join(repoRoot, "tests/fixtures/editor/formats/samples", filename));
      const report = preflightOoxmlPackage(bytes);
      expect(report.entryCount, filename).toBeGreaterThan(2);
      expect(report.totalUncompressedBytes, filename).toBeGreaterThan(0);
    }
  });

  it("accepts a conventional bounded ZIP and reports central-directory totals", () => {
    const archive = buildZip([
      { name: "[Content_Types].xml", compressedBytes: 8, uncompressedBytes: 16 },
      { name: "_rels/.rels", compressedBytes: 4, uncompressedBytes: 12 },
      { name: "word/document.xml", compressedBytes: 10, uncompressedBytes: 30 },
    ]);

    const report = preflightOoxmlPackage(archive);

    expect(report.entryCount).toBe(3);
    expect(report.totalCompressedBytes).toBe(22);
    expect(report.totalUncompressedBytes).toBe(58);
    expect(report.entries.map((entry) => entry.name)).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "word/document.xml",
    ]);
  });

  it("rejects archives over the entry-count limit before parsing entries", () => {
    const archive = buildZip([
      { name: "one.xml" },
      { name: "two.xml" },
    ]);

    expectPreflightCode(
      () => preflightZipCentralDirectory(archive, { maxEntries: 1 }),
      "entry-count-limit",
    );
  });

  it("rejects an entry whose declared expanded size exceeds its limit", () => {
    const archive = buildZip([
      { name: "word/document.xml", compressedBytes: 10, uncompressedBytes: 1_001 },
    ]);

    expectPreflightCode(
      () => preflightZipCentralDirectory(archive, {
        maxEntryUncompressedBytes: 1_000,
        maxCompressionRatio: 1_000,
      }),
      "entry-size-limit",
    );
  });

  it("rejects an archive whose total expanded size exceeds its limit", () => {
    const archive = buildZip([
      { name: "one.xml", compressedBytes: 8, uncompressedBytes: 8 },
      { name: "two.xml", compressedBytes: 8, uncompressedBytes: 8 },
    ]);

    expectPreflightCode(
      () => preflightZipCentralDirectory(archive, { maxTotalUncompressedBytes: 15 }),
      "total-size-limit",
    );
  });

  it("rejects excessive per-entry and overall compression ratios", () => {
    const entryBomb = buildZip([
      { name: "bomb.xml", compressedBytes: 1, uncompressedBytes: 101 },
    ]);
    expectPreflightCode(
      () => preflightZipCentralDirectory(entryBomb, { maxCompressionRatio: 100 }),
      "compression-ratio-limit",
    );

    const impossibleZeroByteCompression = buildZip([
      { name: "zero-byte-bomb.xml", compressedBytes: 0, uncompressedBytes: 1 },
    ]);
    expectPreflightCode(
      () => preflightZipCentralDirectory(impossibleZeroByteCompression),
      "compression-ratio-limit",
    );

    const aggregateBomb = buildZip([
      { name: "one.xml", compressedBytes: 10, uncompressedBytes: 60 },
      { name: "two.xml", compressedBytes: 10, uncompressedBytes: 60 },
    ]);
    expectPreflightCode(
      () => preflightZipCentralDirectory(aggregateBomb, {
        maxCompressionRatio: 10,
        maxOverallCompressionRatio: 5,
      }),
      "compression-ratio-limit",
    );
  });

  it("rejects encrypted, unsupported-method, duplicate, and unsafe-path entries", () => {
    expectPreflightCode(
      () => preflightZipCentralDirectory(buildZip([{ name: "secret.xml", flags: 1 }])),
      "encrypted-entry-not-supported",
    );
    expectPreflightCode(
      () => preflightZipCentralDirectory(buildZip([{ name: "entry.xml", compressionMethod: 99 }])),
      "unsupported-compression-method",
    );
    expectPreflightCode(
      () => preflightZipCentralDirectory(buildZip([{ name: "patched.xml", flags: UTF8_FILENAME_FLAG | (1 << 5) }])),
      "unsupported-entry-flags",
    );
    expectPreflightCode(
      () => preflightZipCentralDirectory(buildZip([{ name: "same.xml" }, { name: "same.xml" }])),
      "duplicate-entry",
    );
    expectPreflightCode(
      () => preflightZipCentralDirectory(buildZip([{ name: "../outside.xml" }])),
      "unsafe-entry-path",
    );
  });

  it("rejects malformed central-directory and local-header metadata", () => {
    const badCentralSignature = buildZip([{ name: "entry.xml" }]);
    const centralOffset = readEocdView(badCentralSignature).getUint32(16, true);
    new DataView(badCentralSignature.buffer).setUint32(centralOffset, 0xdeadbeef, true);
    expectPreflightCode(
      () => preflightZipCentralDirectory(badCentralSignature),
      "malformed-central-directory",
    );

    const badLocalSignature = buildZip([{ name: "entry.xml" }]);
    new DataView(badLocalSignature.buffer).setUint32(0, 0xdeadbeef, true);
    expectPreflightCode(
      () => preflightZipCentralDirectory(badLocalSignature),
      "malformed-local-header",
    );

    const mismatchedLocalSize = buildZip([{ name: "entry.xml", compressedBytes: 2, uncompressedBytes: 3 }]);
    new DataView(mismatchedLocalSize.buffer).setUint32(22, 2, true);
    expectPreflightCode(
      () => preflightZipCentralDirectory(mismatchedLocalSize),
      "malformed-local-header",
    );
  });

  it("rejects ZIP64 sentinel metadata and ZIP64 extra fields", () => {
    const zip64Sentinel = buildZip([{ name: "entry.xml" }]);
    readEocdView(zip64Sentinel).setUint16(10, 0xffff, true);
    expectPreflightCode(
      () => preflightZipCentralDirectory(zip64Sentinel),
      "zip64-not-supported",
    );

    const zip64Extra = buildZip([{
      name: "entry.xml",
      centralExtra: new Uint8Array([0x01, 0x00, 0x00, 0x00]),
    }]);
    expectPreflightCode(
      () => preflightZipCentralDirectory(zip64Extra),
      "zip64-not-supported",
    );

    const conventional = buildZip([{ name: "entry.xml" }]);
    const eocdOffset = conventional.byteLength - 22;
    const zip64Locator = new Uint8Array(20);
    new DataView(zip64Locator.buffer).setUint32(0, 0x07064b50, true);
    const zip64LocatorArchive = concatBytes([
      conventional.subarray(0, eocdOffset),
      zip64Locator,
      conventional.subarray(eocdOffset),
    ]);
    expectPreflightCode(
      () => preflightZipCentralDirectory(zip64LocatorArchive),
      "zip64-not-supported",
    );
  });

  it("rejects multi-disk metadata and archives with trailing bytes", () => {
    const multiDisk = buildZip([{ name: "entry.xml" }]);
    readEocdView(multiDisk).setUint16(4, 1, true);
    expectPreflightCode(
      () => preflightZipCentralDirectory(multiDisk),
      "multi-disk-not-supported",
    );

    const entryOnAnotherDisk = buildZip([{ name: "entry.xml" }]);
    const centralOffset = readEocdView(entryOnAnotherDisk).getUint32(16, true);
    new DataView(entryOnAnotherDisk.buffer).setUint16(centralOffset + 34, 1, true);
    expectPreflightCode(
      () => preflightZipCentralDirectory(entryOnAnotherDisk),
      "multi-disk-not-supported",
    );

    const conventional = buildZip([{ name: "entry.xml" }]);
    const withTrailingByte = concatBytes([conventional, new Uint8Array([0])]);
    expectPreflightCode(
      () => preflightZipCentralDirectory(withTrailingByte),
      "end-of-central-directory-not-found",
    );
  });

  it("requires OPC package markers for the OOXML wrapper", () => {
    const plainZip = buildZip([{ name: "word/document.xml" }]);
    expectPreflightCode(() => preflightOoxmlPackage(plainZip), "missing-ooxml-entry");
  });
});

function expectPreflightCode(run: () => unknown, code: ZipPreflightErrorCode) {
  try {
    run();
    throw new Error(`Expected ZipPreflightError with code ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(ZipPreflightError);
    expect((error as ZipPreflightError).code).toBe(code);
  }
}

function buildZip(entries: TestZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localRecords: Uint8Array[] = [];
  const centralRecords: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const compressedBytes = entry.compressedBytes ?? 1;
    const uncompressedBytes = entry.uncompressedBytes ?? compressedBytes;
    const compressionMethod = entry.compressionMethod ?? 0;
    const flags = entry.flags ?? UTF8_FILENAME_FLAG;
    const localExtra = entry.localExtra ?? new Uint8Array(0);
    const centralExtra = entry.centralExtra ?? new Uint8Array(0);
    const data = new Uint8Array(compressedBytes);

    const local = new Uint8Array(30 + name.byteLength + localExtra.byteLength + data.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, LOCAL_FILE_HEADER_SIGNATURE, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, flags, true);
    localView.setUint16(8, compressionMethod, true);
    localView.setUint32(18, compressedBytes, true);
    localView.setUint32(22, uncompressedBytes, true);
    localView.setUint16(26, name.byteLength, true);
    localView.setUint16(28, localExtra.byteLength, true);
    local.set(name, 30);
    local.set(localExtra, 30 + name.byteLength);
    local.set(data, 30 + name.byteLength + localExtra.byteLength);
    localRecords.push(local);

    const central = new Uint8Array(46 + name.byteLength + centralExtra.byteLength);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, CENTRAL_DIRECTORY_HEADER_SIGNATURE, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, flags, true);
    centralView.setUint16(10, compressionMethod, true);
    centralView.setUint32(20, compressedBytes, true);
    centralView.setUint32(24, uncompressedBytes, true);
    centralView.setUint16(28, name.byteLength, true);
    centralView.setUint16(30, centralExtra.byteLength, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    central.set(centralExtra, 46 + name.byteLength);
    centralRecords.push(central);
    localOffset += local.byteLength;
  }

  const centralDirectory = concatBytes(centralRecords);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralDirectory.byteLength, true);
  eocdView.setUint32(16, localOffset, true);
  return concatBytes([...localRecords, centralDirectory, eocd]);
}

function readEocdView(archive: Uint8Array): DataView {
  return new DataView(archive.buffer, archive.byteOffset + archive.byteLength - 22, 22);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

const UTF8_FILENAME_FLAG = 1 << 11;
