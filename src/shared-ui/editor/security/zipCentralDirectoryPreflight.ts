const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EXTRA_FIELD_ID = 0x0001;

const LOCAL_FILE_HEADER_BYTES = 30;
const CENTRAL_DIRECTORY_HEADER_BYTES = 46;
const END_OF_CENTRAL_DIRECTORY_BYTES = 22;
const MAX_ZIP_COMMENT_BYTES = 0xffff;

const UTF8_FILENAME_FLAG = 1 << 11;
const ENCRYPTED_FLAG = 1 << 0;
const DATA_DESCRIPTOR_FLAG = 1 << 3;
const PATCHED_DATA_FLAG = 1 << 5;
const STRONG_ENCRYPTION_FLAG = 1 << 6;
const MASKED_LOCAL_HEADER_FLAG = 1 << 13;

const OOXML_REQUIRED_ENTRIES = ["[Content_Types].xml", "_rels/.rels"] as const;
const ODS_REQUIRED_ENTRIES = ["mimetype", "content.xml", "META-INF/manifest.xml"] as const;

export type ZipPreflightErrorCode =
  | "end-of-central-directory-not-found"
  | "multi-disk-not-supported"
  | "zip64-not-supported"
  | "central-directory-out-of-bounds"
  | "malformed-central-directory"
  | "malformed-local-header"
  | "entry-count-limit"
  | "entry-size-limit"
  | "total-size-limit"
  | "compression-ratio-limit"
  | "encrypted-entry-not-supported"
  | "unsupported-entry-flags"
  | "unsupported-compression-method"
  | "unsafe-entry-path"
  | "duplicate-entry"
  | "missing-ooxml-entry"
  | "missing-ods-entry";

export class ZipPreflightError extends Error {
  readonly code: ZipPreflightErrorCode;
  readonly entryName: string | null;

  constructor(code: ZipPreflightErrorCode, message: string, entryName: string | null = null) {
    super(message);
    this.name = "ZipPreflightError";
    this.code = code;
    this.entryName = entryName;
  }
}

export type ZipCentralDirectoryPolicy = {
  maxEntries: number;
  maxEntryUncompressedBytes: number;
  maxTotalUncompressedBytes: number;
  maxCompressionRatio: number;
  maxOverallCompressionRatio: number;
  allowedCompressionMethods: readonly number[];
};

export const DEFAULT_OOXML_ZIP_POLICY: Readonly<ZipCentralDirectoryPolicy> = Object.freeze({
  maxEntries: 4_096,
  maxEntryUncompressedBytes: 64 * 1024 * 1024,
  maxTotalUncompressedBytes: 256 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxOverallCompressionRatio: 100,
  // OOXML packages use stored or DEFLATE entries. These are also the methods
  // supported by the browser parsers currently used by the editor.
  allowedCompressionMethods: Object.freeze([0, 8]),
});

export type ZipCentralDirectoryEntry = {
  name: string;
  compressionMethod: number;
  compressedBytes: number;
  uncompressedBytes: number;
  compressionRatio: number;
  localHeaderOffset: number;
  directory: boolean;
};

export type ZipCentralDirectoryReport = {
  archiveBytes: number;
  centralDirectoryOffset: number;
  centralDirectoryBytes: number;
  entryCount: number;
  totalCompressedBytes: number;
  totalUncompressedBytes: number;
  overallCompressionRatio: number;
  entries: ZipCentralDirectoryEntry[];
};

/**
 * Inspects ZIP metadata without inflating any entry. The parser is deliberately
 * strict because OOXML previews consume untrusted archives in an interactive
 * renderer. Ambiguous features (multi-disk, ZIP64, duplicate names, encrypted
 * entries, unsafe paths) are rejected before a third-party parser sees bytes.
 * This is a metadata preflight, not a decompression sandbox: the eventual
 * inflater must still enforce actual output, memory, and CPU quotas because a
 * malicious stream can lie in both local and central size fields.
 */
export function preflightZipCentralDirectory(
  input: ArrayBuffer | Uint8Array,
  policyOverrides: Partial<ZipCentralDirectoryPolicy> = {},
): ZipCentralDirectoryReport {
  const bytes = toUint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const policy = resolvePolicy(policyOverrides);
  const eocdOffset = findEndOfCentralDirectory(view);

  if (eocdOffset < 0) {
    throw new ZipPreflightError(
      "end-of-central-directory-not-found",
      "The file is not a complete, conventional ZIP archive.",
    );
  }

  rejectZip64Locator(view, eocdOffset);

  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDirectoryDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectoryBytes = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);

  if (
    entriesOnDisk === 0xffff
    || entryCount === 0xffff
    || centralDirectoryBytes === 0xffffffff
    || centralDirectoryOffset === 0xffffffff
  ) {
    throw new ZipPreflightError("zip64-not-supported", "ZIP64 archives are not accepted for Office preview.");
  }

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new ZipPreflightError(
      "multi-disk-not-supported",
      "Multi-disk or internally inconsistent ZIP archives are not accepted.",
    );
  }

  if (entryCount > policy.maxEntries) {
    throw new ZipPreflightError(
      "entry-count-limit",
      `The archive contains ${entryCount} entries; the preview limit is ${policy.maxEntries}.`,
    );
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectoryBytes;
  if (
    !Number.isSafeInteger(centralDirectoryEnd)
    || centralDirectoryOffset > eocdOffset
    || centralDirectoryEnd !== eocdOffset
  ) {
    throw new ZipPreflightError(
      "central-directory-out-of-bounds",
      "The ZIP central directory is outside the archive or has unexplained trailing records.",
    );
  }

  const allowedCompressionMethods = new Set(policy.allowedCompressionMethods);
  const names = new Set<string>();
  const localHeaderOffsets = new Set<number>();
  const entries: ZipCentralDirectoryEntry[] = [];
  let cursor = centralDirectoryOffset;
  let totalCompressedBytes = 0;
  let totalUncompressedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + CENTRAL_DIRECTORY_HEADER_BYTES > centralDirectoryEnd) {
      throw new ZipPreflightError("malformed-central-directory", "A central-directory entry is truncated.");
    }
    if (view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_HEADER_SIGNATURE) {
      throw new ZipPreflightError("malformed-central-directory", "A central-directory entry has an invalid signature.");
    }

    const flags = view.getUint16(cursor + 8, true);
    const compressionMethod = view.getUint16(cursor + 10, true);
    const compressedBytes = view.getUint32(cursor + 20, true);
    const uncompressedBytes = view.getUint32(cursor + 24, true);
    const filenameBytes = view.getUint16(cursor + 28, true);
    const extraBytes = view.getUint16(cursor + 30, true);
    const commentBytes = view.getUint16(cursor + 32, true);
    const startingDisk = view.getUint16(cursor + 34, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);

    if (
      compressedBytes === 0xffffffff
      || uncompressedBytes === 0xffffffff
      || localHeaderOffset === 0xffffffff
      || startingDisk === 0xffff
    ) {
      throw new ZipPreflightError("zip64-not-supported", "ZIP64 entry metadata is not accepted for Office preview.");
    }
    if (startingDisk !== 0) {
      throw new ZipPreflightError(
        "multi-disk-not-supported",
        "A ZIP entry points at another disk, which is not supported for preview.",
      );
    }

    const filenameStart = cursor + CENTRAL_DIRECTORY_HEADER_BYTES;
    const filenameEnd = filenameStart + filenameBytes;
    const extraEnd = filenameEnd + extraBytes;
    const entryEnd = extraEnd + commentBytes;
    if (entryEnd > centralDirectoryEnd) {
      throw new ZipPreflightError("malformed-central-directory", "A central-directory entry exceeds its declared bounds.");
    }

    rejectZip64ExtraField(view, filenameEnd, extraEnd);
    const name = decodeEntryName(bytes.subarray(filenameStart, filenameEnd), Boolean(flags & UTF8_FILENAME_FLAG));
    validateEntryName(name);

    if (names.has(name)) {
      throw new ZipPreflightError("duplicate-entry", `The archive contains a duplicate entry named ${name}.`, name);
    }
    names.add(name);

    if ((flags & ENCRYPTED_FLAG) !== 0 || (flags & STRONG_ENCRYPTION_FLAG) !== 0) {
      throw new ZipPreflightError(
        "encrypted-entry-not-supported",
        `Encrypted ZIP entry ${name} is not supported for preview.`,
        name,
      );
    }
    if ((flags & (PATCHED_DATA_FLAG | MASKED_LOCAL_HEADER_FLAG)) !== 0) {
      throw new ZipPreflightError(
        "unsupported-entry-flags",
        `ZIP entry ${name} uses ambiguous or unsupported header features.`,
        name,
      );
    }
    if (!allowedCompressionMethods.has(compressionMethod)) {
      throw new ZipPreflightError(
        "unsupported-compression-method",
        `ZIP entry ${name} uses unsupported compression method ${compressionMethod}.`,
        name,
      );
    }
    if (uncompressedBytes > policy.maxEntryUncompressedBytes) {
      throw new ZipPreflightError(
        "entry-size-limit",
        `ZIP entry ${name} expands beyond the per-entry preview limit.`,
        name,
      );
    }

    const compressionRatio = calculateCompressionRatio(uncompressedBytes, compressedBytes);
    if (compressionRatio > policy.maxCompressionRatio) {
      throw new ZipPreflightError(
        "compression-ratio-limit",
        `ZIP entry ${name} exceeds the allowed compression ratio.`,
        name,
      );
    }

    validateLocalHeader({
      bytes,
      view,
      centralDirectoryOffset,
      localHeaderOffset,
      expectedFlags: flags,
      expectedCompressionMethod: compressionMethod,
      expectedCompressedBytes: compressedBytes,
      expectedUncompressedBytes: uncompressedBytes,
      expectedFilename: bytes.subarray(filenameStart, filenameEnd),
      localHeaderOffsets,
      entryName: name,
    });

    totalCompressedBytes += compressedBytes;
    totalUncompressedBytes += uncompressedBytes;
    if (totalUncompressedBytes > policy.maxTotalUncompressedBytes) {
      throw new ZipPreflightError(
        "total-size-limit",
        "The archive expands beyond the total Office preview limit.",
        name,
      );
    }

    entries.push({
      name,
      compressionMethod,
      compressedBytes,
      uncompressedBytes,
      compressionRatio,
      localHeaderOffset,
      directory: name.endsWith("/"),
    });
    cursor = entryEnd;
  }

  if (cursor !== centralDirectoryEnd) {
    throw new ZipPreflightError(
      "malformed-central-directory",
      "The central-directory entry count does not match its declared byte length.",
    );
  }

  const overallCompressionRatio = calculateCompressionRatio(totalUncompressedBytes, totalCompressedBytes);
  if (overallCompressionRatio > policy.maxOverallCompressionRatio) {
    throw new ZipPreflightError(
      "compression-ratio-limit",
      "The archive exceeds the allowed overall compression ratio.",
    );
  }

  return {
    archiveBytes: bytes.byteLength,
    centralDirectoryOffset,
    centralDirectoryBytes,
    entryCount,
    totalCompressedBytes,
    totalUncompressedBytes,
    overallCompressionRatio,
    entries,
  };
}

/** Strict ZIP preflight plus the two package markers required by OPC/OOXML. */
export function preflightOoxmlPackage(
  input: ArrayBuffer | Uint8Array,
  policyOverrides: Partial<ZipCentralDirectoryPolicy> = {},
): ZipCentralDirectoryReport {
  const report = preflightZipCentralDirectory(input, policyOverrides);
  const names = new Set(report.entries.map((entry) => entry.name));
  for (const requiredName of OOXML_REQUIRED_ENTRIES) {
    if (!names.has(requiredName)) {
      throw new ZipPreflightError(
        "missing-ooxml-entry",
        `The archive is not a complete OOXML package: missing ${requiredName}.`,
        requiredName,
      );
    }
  }
  return report;
}

/** Strict ZIP preflight plus the package markers required by ODS/OTS files. */
export function preflightOdsPackage(
  input: ArrayBuffer | Uint8Array,
  policyOverrides: Partial<ZipCentralDirectoryPolicy> = {},
): ZipCentralDirectoryReport {
  const report = preflightZipCentralDirectory(input, policyOverrides);
  const entries = new Map(report.entries.map((entry) => [entry.name, entry]));
  for (const requiredName of ODS_REQUIRED_ENTRIES) {
    if (!entries.has(requiredName)) {
      throw new ZipPreflightError(
        "missing-ods-entry",
        `The archive is not a complete OpenDocument spreadsheet package: missing ${requiredName}.`,
        requiredName,
      );
    }
  }

  const mimetype = entries.get("mimetype");
  if (mimetype?.compressionMethod !== 0) {
    throw new ZipPreflightError(
      "unsupported-compression-method",
      "The OpenDocument mimetype entry must be stored without compression.",
      "mimetype",
    );
  }
  return report;
}

function resolvePolicy(overrides: Partial<ZipCentralDirectoryPolicy>): ZipCentralDirectoryPolicy {
  const policy: ZipCentralDirectoryPolicy = {
    ...DEFAULT_OOXML_ZIP_POLICY,
    ...overrides,
    allowedCompressionMethods: overrides.allowedCompressionMethods ?? DEFAULT_OOXML_ZIP_POLICY.allowedCompressionMethods,
  };

  assertPositiveInteger("maxEntries", policy.maxEntries);
  assertPositiveInteger("maxEntryUncompressedBytes", policy.maxEntryUncompressedBytes);
  assertPositiveInteger("maxTotalUncompressedBytes", policy.maxTotalUncompressedBytes);
  assertPositiveNumber("maxCompressionRatio", policy.maxCompressionRatio);
  assertPositiveNumber("maxOverallCompressionRatio", policy.maxOverallCompressionRatio);
  if (policy.allowedCompressionMethods.length === 0 || policy.allowedCompressionMethods.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new TypeError("allowedCompressionMethods must contain non-negative integer method ids.");
  }
  return policy;
}

function assertPositiveInteger(name: string, value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer.`);
}

function assertPositiveNumber(name: string, value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${name} must be a positive finite number.`);
}

function toUint8Array(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function findEndOfCentralDirectory(view: DataView): number {
  if (view.byteLength < END_OF_CENTRAL_DIRECTORY_BYTES) return -1;
  const firstCandidate = Math.max(
    0,
    view.byteLength - END_OF_CENTRAL_DIRECTORY_BYTES - MAX_ZIP_COMMENT_BYTES,
  );

  for (let offset = view.byteLength - END_OF_CENTRAL_DIRECTORY_BYTES; offset >= firstCandidate; offset -= 1) {
    if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    const commentBytes = view.getUint16(offset + 20, true);
    if (offset + END_OF_CENTRAL_DIRECTORY_BYTES + commentBytes === view.byteLength) return offset;
  }
  return -1;
}

function rejectZip64Locator(view: DataView, eocdOffset: number) {
  if (
    eocdOffset >= 20
    && view.getUint32(eocdOffset - 20, true) === ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE
  ) {
    throw new ZipPreflightError("zip64-not-supported", "ZIP64 archives are not accepted for Office preview.");
  }
}

function rejectZip64ExtraField(view: DataView, start: number, end: number) {
  let cursor = start;
  while (cursor < end) {
    if (cursor + 4 > end) {
      throw new ZipPreflightError("malformed-central-directory", "A ZIP extra field is truncated.");
    }
    const fieldId = view.getUint16(cursor, true);
    const fieldBytes = view.getUint16(cursor + 2, true);
    cursor += 4;
    if (cursor + fieldBytes > end) {
      throw new ZipPreflightError("malformed-central-directory", "A ZIP extra field exceeds its declared bounds.");
    }
    if (fieldId === ZIP64_EXTRA_FIELD_ID) {
      throw new ZipPreflightError("zip64-not-supported", "ZIP64 entry metadata is not accepted for Office preview.");
    }
    cursor += fieldBytes;
  }
}

function decodeEntryName(bytes: Uint8Array, utf8: boolean): string {
  try {
    if (utf8) return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // OOXML package names are ASCII. latin1 preserves every byte so unsafe or
    // malformed legacy names cannot disappear during decoding.
    return new TextDecoder("latin1").decode(bytes);
  } catch {
    throw new ZipPreflightError("malformed-central-directory", "A ZIP entry name is not valid text.");
  }
}

function validateEntryName(name: string) {
  const withoutTrailingSlash = name.endsWith("/") ? name.slice(0, -1) : name;
  const segments = withoutTrailingSlash.split("/");
  if (
    !name
    || !withoutTrailingSlash
    || /[\u0000-\u001f\u007f]/.test(name)
    || name.startsWith("/")
    || name.startsWith("\\")
    || name.includes("\\")
    || /^[a-z]:/i.test(name)
    || segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new ZipPreflightError("unsafe-entry-path", `Unsafe ZIP entry path: ${name || "(empty)"}.`, name || null);
  }
}

function calculateCompressionRatio(uncompressedBytes: number, compressedBytes: number): number {
  if (uncompressedBytes === 0) return 0;
  if (compressedBytes === 0) return Number.POSITIVE_INFINITY;
  return uncompressedBytes / compressedBytes;
}

function validateLocalHeader({
  bytes,
  view,
  centralDirectoryOffset,
  localHeaderOffset,
  expectedFlags,
  expectedCompressionMethod,
  expectedCompressedBytes,
  expectedUncompressedBytes,
  expectedFilename,
  localHeaderOffsets,
  entryName,
}: {
  bytes: Uint8Array;
  view: DataView;
  centralDirectoryOffset: number;
  localHeaderOffset: number;
  expectedFlags: number;
  expectedCompressionMethod: number;
  expectedCompressedBytes: number;
  expectedUncompressedBytes: number;
  expectedFilename: Uint8Array;
  localHeaderOffsets: Set<number>;
  entryName: string;
}) {
  if (localHeaderOffsets.has(localHeaderOffset)) {
    throw new ZipPreflightError("malformed-local-header", "Multiple entries point at the same local header.", entryName);
  }
  localHeaderOffsets.add(localHeaderOffset);

  if (localHeaderOffset + LOCAL_FILE_HEADER_BYTES > centralDirectoryOffset) {
    throw new ZipPreflightError("malformed-local-header", "A local ZIP header is outside the file-data region.", entryName);
  }
  if (view.getUint32(localHeaderOffset, true) !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new ZipPreflightError("malformed-local-header", "A local ZIP header has an invalid signature.", entryName);
  }

  const localFlags = view.getUint16(localHeaderOffset + 6, true);
  const localCompressionMethod = view.getUint16(localHeaderOffset + 8, true);
  const localCompressedBytes = view.getUint32(localHeaderOffset + 18, true);
  const localUncompressedBytes = view.getUint32(localHeaderOffset + 22, true);
  const localFilenameBytes = view.getUint16(localHeaderOffset + 26, true);
  const localExtraBytes = view.getUint16(localHeaderOffset + 28, true);
  const localFilenameStart = localHeaderOffset + LOCAL_FILE_HEADER_BYTES;
  const localFilenameEnd = localFilenameStart + localFilenameBytes;
  const localExtraEnd = localFilenameEnd + localExtraBytes;
  const dataEnd = localExtraEnd + expectedCompressedBytes;

  if (localExtraEnd > centralDirectoryOffset || dataEnd > centralDirectoryOffset) {
    throw new ZipPreflightError("malformed-local-header", "A local ZIP entry exceeds the file-data region.", entryName);
  }
  if (localFlags !== expectedFlags || localCompressionMethod !== expectedCompressionMethod) {
    throw new ZipPreflightError("malformed-local-header", "Local and central ZIP metadata disagree.", entryName);
  }
  if ((expectedFlags & DATA_DESCRIPTOR_FLAG) === 0) {
    if (localCompressedBytes !== expectedCompressedBytes || localUncompressedBytes !== expectedUncompressedBytes) {
      throw new ZipPreflightError("malformed-local-header", "Local and central ZIP sizes disagree.", entryName);
    }
  } else if (
    (localCompressedBytes !== 0 && localCompressedBytes !== expectedCompressedBytes)
    || (localUncompressedBytes !== 0 && localUncompressedBytes !== expectedUncompressedBytes)
  ) {
    throw new ZipPreflightError("malformed-local-header", "Data-descriptor ZIP sizes are internally inconsistent.", entryName);
  }

  const localFilename = bytes.subarray(localFilenameStart, localFilenameEnd);
  if (!equalBytes(localFilename, expectedFilename)) {
    throw new ZipPreflightError("malformed-local-header", "Local and central ZIP entry names disagree.", entryName);
  }
  rejectZip64ExtraField(view, localFilenameEnd, localExtraEnd);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
