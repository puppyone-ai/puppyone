import type JSZip from "jszip";
import {
  DEFAULT_OOXML_ZIP_POLICY,
  ZipPreflightError,
  preflightOoxmlPackage,
  preflightZipCentralDirectory,
  type ZipCentralDirectoryEntry,
  type ZipCentralDirectoryReport,
  type ZipPreflightErrorCode,
} from "./zipCentralDirectoryPreflight";

export type OfficePackageValidationProfile = "zip" | "ooxml" | "docx";

export type OfficePackageDecompressionBudget = {
  maxEntryUncompressedBytes: number;
  maxTotalUncompressedBytes: number;
  maxDocxXmlStartTags: number;
};

export const DEFAULT_OFFICE_PACKAGE_DECOMPRESSION_BUDGET: Readonly<OfficePackageDecompressionBudget> =
  Object.freeze({
    maxEntryUncompressedBytes: DEFAULT_OOXML_ZIP_POLICY.maxEntryUncompressedBytes,
    maxTotalUncompressedBytes: DEFAULT_OOXML_ZIP_POLICY.maxTotalUncompressedBytes,
    maxDocxXmlStartTags: 250_000,
  });

export type OfficePackageValidationOptions = {
  profile: OfficePackageValidationProfile;
  budget?: Partial<OfficePackageDecompressionBudget>;
};

export type OfficePackageEntryValidationReport = {
  name: string;
  declaredUncompressedBytes: number;
  actualUncompressedBytes: number;
  docxXmlStartTags: number;
};

export type OfficePackageValidationReport = {
  profile: OfficePackageValidationProfile;
  entryCount: number;
  declaredTotalUncompressedBytes: number;
  actualTotalUncompressedBytes: number;
  docxXmlStartTags: number;
  entries: OfficePackageEntryValidationReport[];
};

export type OfficePackageValidationResult = {
  /** The same transferable buffer supplied to the task. */
  arrayBuffer: ArrayBuffer;
  report: OfficePackageValidationReport;
};

export type OfficePackageValidationErrorCode =
  | "zip-entry-missing"
  | "actual-entry-size-mismatch"
  | "actual-entry-size-limit"
  | "actual-total-size-limit"
  | "docx-xml-start-tag-limit";

type OfficePackageValidationErrorDetails = {
  entryName?: string | null;
  declaredBytes?: number | null;
  actualBytes?: number | null;
  limit?: number | null;
};

export class OfficePackageValidationError extends Error {
  readonly code: OfficePackageValidationErrorCode;
  readonly entryName: string | null;
  readonly declaredBytes: number | null;
  readonly actualBytes: number | null;
  readonly limit: number | null;

  constructor(
    code: OfficePackageValidationErrorCode,
    message: string,
    details: OfficePackageValidationErrorDetails = {},
  ) {
    super(message);
    this.name = "OfficePackageValidationError";
    this.code = code;
    this.entryName = details.entryName ?? null;
    this.declaredBytes = details.declaredBytes ?? null;
    this.actualBytes = details.actualBytes ?? null;
    this.limit = details.limit ?? null;
  }
}

export type SerializedOfficePackageValidationError = {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  entryName?: string | null;
  declaredBytes?: number | null;
  actualBytes?: number | null;
  limit?: number | null;
};

export type OfficePackageValidationWorkerRequest = {
  arrayBuffer: ArrayBuffer;
  options: OfficePackageValidationOptions;
};

export type OfficePackageValidationWorkerResponse =
  | { ok: true; result: OfficePackageValidationResult }
  | {
    ok: false;
    error: SerializedOfficePackageValidationError;
    arrayBuffer: ArrayBuffer;
  };

export type OfficePackageValidationWorkerPostMessage = (
  response: OfficePackageValidationWorkerResponse,
  transfer: Transferable[],
) => void;

type StreamableZipObject = JSZip.JSZipObject & {
  // JSZip exposes this API at runtime but omits it from JSZipObject's public typings.
  internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
};

type MutableValidationTotals = {
  actualBytes: number;
  docxXmlStartTags: number;
};

type XmlStartTagCounterState = {
  afterLessThan: boolean;
};

/**
 * Validate an Office ZIP without materializing decompressed entries. Central
 * metadata is checked first, then every file is drained sequentially through
 * JSZip's internal stream while actual output budgets are enforced.
 */
export async function validateOfficePackageDecompression(
  arrayBuffer: ArrayBuffer,
  options: OfficePackageValidationOptions,
): Promise<OfficePackageValidationResult> {
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    throw new TypeError("Office package validation requires an ArrayBuffer.");
  }

  const profile = requireValidationProfile(options?.profile);
  const budget = resolveDecompressionBudget(options?.budget);
  const centralReport = preflightPackage(arrayBuffer, profile, budget);
  const { default: JSZipRuntime } = await import("jszip");
  const zip = await JSZipRuntime.loadAsync(arrayBuffer, { createFolders: false });
  const totals: MutableValidationTotals = { actualBytes: 0, docxXmlStartTags: 0 };
  const entries: OfficePackageEntryValidationReport[] = [];

  for (const declaredEntry of centralReport.entries) {
    const loadedEntry = zip.files[declaredEntry.name] as StreamableZipObject | undefined;
    if (!loadedEntry) {
      throw new OfficePackageValidationError(
        "zip-entry-missing",
        `ZIP entry ${declaredEntry.name} disappeared while loading the Office package.`,
        { entryName: declaredEntry.name },
      );
    }

    if (declaredEntry.directory || loadedEntry.dir) {
      assertActualMatchesDeclared(declaredEntry, 0);
      entries.push(toEntryReport(declaredEntry, 0, 0));
      continue;
    }

    const entryReport = await drainZipEntry({
      entry: loadedEntry,
      declaredEntry,
      budget,
      totals,
      countDocxXmlTags: profile === "docx" && isDocxXmlEntry(declaredEntry.name),
    });
    entries.push(entryReport);
  }

  if (totals.actualBytes !== centralReport.totalUncompressedBytes) {
    throw new OfficePackageValidationError(
      "actual-entry-size-mismatch",
      "The Office package produced a different total size than its central directory declared.",
      {
        declaredBytes: centralReport.totalUncompressedBytes,
        actualBytes: totals.actualBytes,
      },
    );
  }

  return {
    arrayBuffer,
    report: {
      profile,
      entryCount: centralReport.entryCount,
      declaredTotalUncompressedBytes: centralReport.totalUncompressedBytes,
      actualTotalUncompressedBytes: totals.actualBytes,
      docxXmlStartTags: totals.docxXmlStartTags,
      entries,
    },
  };
}

/** Run one worker request and always transfer ownership of its input buffer back. */
export async function runOfficePackageValidationWorkerTask(
  request: OfficePackageValidationWorkerRequest,
  postMessage: OfficePackageValidationWorkerPostMessage,
): Promise<void> {
  try {
    const result = await validateOfficePackageDecompression(request.arrayBuffer, request.options);
    postMessage({ ok: true, result }, [result.arrayBuffer]);
  } catch (error) {
    postMessage(
      {
        ok: false,
        error: serializeOfficePackageValidationError(error),
        arrayBuffer: request.arrayBuffer,
      },
      [request.arrayBuffer],
    );
  }
}

export function serializeOfficePackageValidationError(
  error: unknown,
): SerializedOfficePackageValidationError {
  if (!(error instanceof Error)) {
    return { name: "Error", message: String(error) };
  }

  const details = error as Error & {
    code?: unknown;
    entryName?: unknown;
    declaredBytes?: unknown;
    actualBytes?: unknown;
    limit?: unknown;
  };
  const serialized: SerializedOfficePackageValidationError = {
    name: error.name,
    message: error.message,
  };
  if (error.stack) serialized.stack = error.stack;
  if (typeof details.code === "string") serialized.code = details.code;
  if (typeof details.entryName === "string" || details.entryName === null) {
    serialized.entryName = details.entryName;
  }
  if (typeof details.declaredBytes === "number" || details.declaredBytes === null) {
    serialized.declaredBytes = details.declaredBytes;
  }
  if (typeof details.actualBytes === "number" || details.actualBytes === null) {
    serialized.actualBytes = details.actualBytes;
  }
  if (typeof details.limit === "number" || details.limit === null) {
    serialized.limit = details.limit;
  }
  return serialized;
}

export function deserializeOfficePackageValidationError(
  serialized: SerializedOfficePackageValidationError,
): Error {
  let error: Error;
  if (
    serialized.name === "OfficePackageValidationError"
    && isOfficePackageValidationErrorCode(serialized.code)
  ) {
    error = new OfficePackageValidationError(serialized.code, serialized.message, {
      entryName: serialized.entryName,
      declaredBytes: serialized.declaredBytes,
      actualBytes: serialized.actualBytes,
      limit: serialized.limit,
    });
  } else if (
    serialized.name === "ZipPreflightError"
    && isZipPreflightErrorCode(serialized.code)
  ) {
    error = new ZipPreflightError(
      serialized.code,
      serialized.message,
      serialized.entryName ?? null,
    );
  } else {
    error = new Error(serialized.message);
    error.name = serialized.name;
    assignSerializedErrorDetails(error, serialized);
  }

  if (serialized.stack) error.stack = serialized.stack;
  return error;
}

function preflightPackage(
  arrayBuffer: ArrayBuffer,
  profile: OfficePackageValidationProfile,
  budget: OfficePackageDecompressionBudget,
): ZipCentralDirectoryReport {
  const policy = {
    maxEntryUncompressedBytes: budget.maxEntryUncompressedBytes,
    maxTotalUncompressedBytes: budget.maxTotalUncompressedBytes,
  };
  return profile === "zip"
    ? preflightZipCentralDirectory(arrayBuffer, policy)
    : preflightOoxmlPackage(arrayBuffer, policy);
}

function drainZipEntry({
  entry,
  declaredEntry,
  budget,
  totals,
  countDocxXmlTags,
}: {
  entry: StreamableZipObject;
  declaredEntry: ZipCentralDirectoryEntry;
  budget: OfficePackageDecompressionBudget;
  totals: MutableValidationTotals;
  countDocxXmlTags: boolean;
}): Promise<OfficePackageEntryValidationReport> {
  return new Promise((resolve, reject) => {
    const stream = entry.internalStream("uint8array");
    const xmlCounterState: XmlStartTagCounterState = { afterLessThan: false };
    let actualBytes = 0;
    let entryXmlStartTags = 0;
    let settled = false;

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      stream.pause();
      reject(error);
    };

    stream.on("data", (chunk) => {
      if (settled) return;
      try {
        actualBytes = checkedAdd(actualBytes, chunk.byteLength, declaredEntry.name);
        totals.actualBytes = checkedAdd(totals.actualBytes, chunk.byteLength, declaredEntry.name);

        if (actualBytes > budget.maxEntryUncompressedBytes) {
          throw new OfficePackageValidationError(
            "actual-entry-size-limit",
            `ZIP entry ${declaredEntry.name} exceeded the actual per-entry decompression limit.`,
            {
              entryName: declaredEntry.name,
              actualBytes,
              limit: budget.maxEntryUncompressedBytes,
            },
          );
        }
        if (totals.actualBytes > budget.maxTotalUncompressedBytes) {
          throw new OfficePackageValidationError(
            "actual-total-size-limit",
            "The Office package exceeded the actual total decompression limit.",
            {
              entryName: declaredEntry.name,
              actualBytes: totals.actualBytes,
              limit: budget.maxTotalUncompressedBytes,
            },
          );
        }
        if (actualBytes > declaredEntry.uncompressedBytes) {
          throw createActualSizeMismatchError(declaredEntry, actualBytes);
        }

        if (countDocxXmlTags) {
          const addedTags = countXmlStartTags(chunk, xmlCounterState);
          entryXmlStartTags = checkedAdd(entryXmlStartTags, addedTags, declaredEntry.name);
          totals.docxXmlStartTags = checkedAdd(
            totals.docxXmlStartTags,
            addedTags,
            declaredEntry.name,
          );
          if (totals.docxXmlStartTags > budget.maxDocxXmlStartTags) {
            throw new OfficePackageValidationError(
              "docx-xml-start-tag-limit",
              "The DOCX package contains too many XML start tags for a safe preview.",
              {
                entryName: declaredEntry.name,
                actualBytes: totals.docxXmlStartTags,
                limit: budget.maxDocxXmlStartTags,
              },
            );
          }
        }
      } catch (error) {
        fail(error);
      }
    });
    stream.on("error", (error) => {
      if (actualBytes !== declaredEntry.uncompressedBytes) {
        fail(createActualSizeMismatchError(declaredEntry, actualBytes));
        return;
      }
      fail(error);
    });
    stream.on("end", () => {
      if (settled) return;
      try {
        assertActualMatchesDeclared(declaredEntry, actualBytes);
        settled = true;
        resolve(toEntryReport(declaredEntry, actualBytes, entryXmlStartTags));
      } catch (error) {
        fail(error);
      }
    });
    stream.resume();
  });
}

function countXmlStartTags(chunk: Uint8Array, state: XmlStartTagCounterState): number {
  let count = 0;
  for (const byte of chunk) {
    if (state.afterLessThan) {
      state.afterLessThan = false;
      if (isXmlNameStartByte(byte)) count += 1;
    }
    if (byte === 0x3c) state.afterLessThan = true;
  }
  return count;
}

function isXmlNameStartByte(byte: number): boolean {
  return (byte >= 0x41 && byte <= 0x5a)
    || (byte >= 0x61 && byte <= 0x7a)
    || byte === 0x3a
    || byte === 0x5f
    || byte >= 0x80;
}

function isDocxXmlEntry(name: string): boolean {
  return /^word\/.*\.xml$/i.test(name);
}

function assertActualMatchesDeclared(entry: ZipCentralDirectoryEntry, actualBytes: number): void {
  if (actualBytes !== entry.uncompressedBytes) {
    throw createActualSizeMismatchError(entry, actualBytes);
  }
}

function createActualSizeMismatchError(
  entry: ZipCentralDirectoryEntry,
  actualBytes: number,
): OfficePackageValidationError {
  return new OfficePackageValidationError(
    "actual-entry-size-mismatch",
    `ZIP entry ${entry.name} produced ${actualBytes} bytes but declared ${entry.uncompressedBytes}.`,
    {
      entryName: entry.name,
      declaredBytes: entry.uncompressedBytes,
      actualBytes,
    },
  );
}

function toEntryReport(
  entry: ZipCentralDirectoryEntry,
  actualUncompressedBytes: number,
  docxXmlStartTags: number,
): OfficePackageEntryValidationReport {
  return {
    name: entry.name,
    declaredUncompressedBytes: entry.uncompressedBytes,
    actualUncompressedBytes,
    docxXmlStartTags,
  };
}

function checkedAdd(left: number, right: number, entryName: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new OfficePackageValidationError(
      "actual-total-size-limit",
      "The Office package decompression counters exceeded the safe integer range.",
      { entryName },
    );
  }
  return result;
}

function resolveDecompressionBudget(
  overrides: Partial<OfficePackageDecompressionBudget> | undefined,
): OfficePackageDecompressionBudget {
  const budget = {
    ...DEFAULT_OFFICE_PACKAGE_DECOMPRESSION_BUDGET,
    ...overrides,
  };
  assertPositiveSafeInteger("maxEntryUncompressedBytes", budget.maxEntryUncompressedBytes);
  assertPositiveSafeInteger("maxTotalUncompressedBytes", budget.maxTotalUncompressedBytes);
  assertPositiveSafeInteger("maxDocxXmlStartTags", budget.maxDocxXmlStartTags);
  return budget;
}

function assertPositiveSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

function requireValidationProfile(profile: unknown): OfficePackageValidationProfile {
  if (profile === "zip" || profile === "ooxml" || profile === "docx") return profile;
  throw new TypeError("Office package validation profile must be zip, ooxml, or docx.");
}

function isOfficePackageValidationErrorCode(
  value: string | undefined,
): value is OfficePackageValidationErrorCode {
  return value === "zip-entry-missing"
    || value === "actual-entry-size-mismatch"
    || value === "actual-entry-size-limit"
    || value === "actual-total-size-limit"
    || value === "docx-xml-start-tag-limit";
}

function isZipPreflightErrorCode(value: string | undefined): value is ZipPreflightErrorCode {
  return value === "end-of-central-directory-not-found"
    || value === "multi-disk-not-supported"
    || value === "zip64-not-supported"
    || value === "central-directory-out-of-bounds"
    || value === "malformed-central-directory"
    || value === "malformed-local-header"
    || value === "entry-count-limit"
    || value === "entry-size-limit"
    || value === "total-size-limit"
    || value === "compression-ratio-limit"
    || value === "encrypted-entry-not-supported"
    || value === "unsupported-entry-flags"
    || value === "unsupported-compression-method"
    || value === "unsafe-entry-path"
    || value === "duplicate-entry"
    || value === "missing-ooxml-entry"
    || value === "missing-ods-entry";
}

function assignSerializedErrorDetails(
  error: Error,
  serialized: SerializedOfficePackageValidationError,
): void {
  const target = error as Error & Record<string, unknown>;
  if (serialized.code !== undefined) target.code = serialized.code;
  if (serialized.entryName !== undefined) target.entryName = serialized.entryName;
  if (serialized.declaredBytes !== undefined) target.declaredBytes = serialized.declaredBytes;
  if (serialized.actualBytes !== undefined) target.actualBytes = serialized.actualBytes;
  if (serialized.limit !== undefined) target.limit = serialized.limit;
}
