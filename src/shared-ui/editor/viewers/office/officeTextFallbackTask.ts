import type JSZip from "jszip";

export const MAX_PRESENTATION_TEXT_SLIDES = 300;
export const MAX_OPEN_DOCUMENT_TEXT_LINES = 400;

const MAX_XML_NESTING_DEPTH = 256;
const MAX_XML_START_TAGS = 250_000;

export type PresentationTextExtractionBudget = {
  maxSlides: number;
  maxSlideXmlBytes: number;
  maxTotalXmlBytes: number;
  maxLinesPerSlide: number;
  maxTotalLines: number;
};

export type OpenDocumentTextExtractionBudget = {
  maxContentXmlBytes: number;
  maxLines: number;
};

export const DEFAULT_PRESENTATION_TEXT_EXTRACTION_BUDGET: Readonly<PresentationTextExtractionBudget> =
  Object.freeze({
    maxSlides: MAX_PRESENTATION_TEXT_SLIDES,
    maxSlideXmlBytes: 4 * 1024 * 1024,
    maxTotalXmlBytes: 32 * 1024 * 1024,
    maxLinesPerSlide: 1_000,
    maxTotalLines: 20_000,
  });

export const DEFAULT_OPEN_DOCUMENT_TEXT_EXTRACTION_BUDGET: Readonly<OpenDocumentTextExtractionBudget> =
  Object.freeze({
    maxContentXmlBytes: 16 * 1024 * 1024,
    maxLines: MAX_OPEN_DOCUMENT_TEXT_LINES,
  });

export type ExtractPresentationTextTask = {
  operation: "extract-presentation-text";
  budget?: Partial<PresentationTextExtractionBudget>;
};

export type ExtractOpenDocumentTextTask = {
  operation: "extract-opendocument-text";
  budget?: Partial<OpenDocumentTextExtractionBudget>;
};

export type OfficeTextFallbackTask =
  | ExtractPresentationTextTask
  | ExtractOpenDocumentTextTask;

export type PresentationFallbackSlide = {
  index: number;
  title: string | null;
  lines: string[];
};

export type PresentationTextFallbackResult = {
  operation: "extract-presentation-text";
  arrayBuffer: ArrayBuffer;
  slides: PresentationFallbackSlide[];
  report: {
    sourceSlideCount: number;
    extractedSlideCount: number;
    truncatedSlideCount: number;
    totalXmlBytes: number;
    totalOutputLines: number;
  };
};

export type OpenDocumentTextFallbackResult = {
  operation: "extract-opendocument-text";
  arrayBuffer: ArrayBuffer;
  lines: string[];
  report: {
    contentXmlBytes: number;
    outputLines: number;
    truncatedLines: boolean;
  };
};

export type OfficeTextFallbackResult =
  | PresentationTextFallbackResult
  | OpenDocumentTextFallbackResult;

export type OfficeTextFallbackErrorCode =
  | "missing-presentation-slides"
  | "missing-content-xml"
  | "entry-xml-size-limit"
  | "total-xml-size-limit"
  | "output-line-limit"
  | "malformed-xml";

type OfficeTextFallbackErrorDetails = {
  entryName?: string | null;
  actual?: number | null;
  limit?: number | null;
};

export class OfficeTextFallbackError extends Error {
  readonly code: OfficeTextFallbackErrorCode;
  readonly entryName: string | null;
  readonly actual: number | null;
  readonly limit: number | null;

  constructor(
    code: OfficeTextFallbackErrorCode,
    message: string,
    details: OfficeTextFallbackErrorDetails = {},
  ) {
    super(message);
    this.name = "OfficeTextFallbackError";
    this.code = code;
    this.entryName = details.entryName ?? null;
    this.actual = details.actual ?? null;
    this.limit = details.limit ?? null;
  }
}

export type SerializedOfficeTextFallbackError = {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  entryName?: string | null;
  actual?: number | null;
  limit?: number | null;
};

export type OfficeTextFallbackWorkerRequest = {
  arrayBuffer: ArrayBuffer;
  task: OfficeTextFallbackTask;
};

export type OfficeTextFallbackWorkerResponse =
  | { ok: true; result: OfficeTextFallbackResult }
  | {
    ok: false;
    error: SerializedOfficeTextFallbackError;
    arrayBuffer: ArrayBuffer;
  };

export type OfficeTextFallbackWorkerPostMessage = (
  response: OfficeTextFallbackWorkerResponse,
  transfer: Transferable[],
) => void;

type StreamableZipObject = JSZip.JSZipObject & {
  internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
};

type XmlLineCollector = {
  elementCount: number;
  lines: string[];
  overflow: boolean;
  storageLimit: number;
};

type XmlCapture = {
  kind: "p" | "t";
  parts: string[];
};

type XmlFrame = {
  name: string;
  capture: XmlCapture | null;
};

type XmlTextCandidates = {
  paragraphs: XmlLineCollector;
  textRuns: XmlLineCollector;
};

/**
 * Extract bounded fallback text after package validation. Only the selected
 * XML entries are inflated and presentation slides are processed serially.
 */
export async function extractOfficeTextFallback(
  arrayBuffer: ArrayBuffer,
  task: OfficeTextFallbackTask,
): Promise<OfficeTextFallbackResult> {
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    throw new TypeError("Office text fallback requires an ArrayBuffer.");
  }

  const { default: JSZipRuntime } = await import("jszip");
  const zip = await JSZipRuntime.loadAsync(arrayBuffer, { createFolders: false });

  if (task.operation === "extract-presentation-text") {
    return extractPresentationText(arrayBuffer, zip, task.budget);
  }
  if (task.operation === "extract-opendocument-text") {
    return extractOpenDocumentText(arrayBuffer, zip, task.budget);
  }
  throw new TypeError("Unsupported Office text fallback operation.");
}

/** Execute one worker request and transfer its input buffer back on success or failure. */
export async function runOfficeTextFallbackWorkerTask(
  request: OfficeTextFallbackWorkerRequest,
  postMessage: OfficeTextFallbackWorkerPostMessage,
): Promise<void> {
  try {
    const result = await extractOfficeTextFallback(request.arrayBuffer, request.task);
    postMessage({ ok: true, result }, [result.arrayBuffer]);
  } catch (error) {
    postMessage(
      {
        ok: false,
        error: serializeOfficeTextFallbackError(error),
        arrayBuffer: request.arrayBuffer,
      },
      [request.arrayBuffer],
    );
  }
}

export function serializeOfficeTextFallbackError(error: unknown): SerializedOfficeTextFallbackError {
  if (!(error instanceof Error)) return { name: "Error", message: String(error) };

  const details = error as Error & {
    code?: unknown;
    entryName?: unknown;
    actual?: unknown;
    limit?: unknown;
  };
  const serialized: SerializedOfficeTextFallbackError = {
    name: error.name,
    message: error.message,
  };
  if (error.stack) serialized.stack = error.stack;
  if (typeof details.code === "string") serialized.code = details.code;
  if (typeof details.entryName === "string" || details.entryName === null) {
    serialized.entryName = details.entryName;
  }
  if (typeof details.actual === "number" || details.actual === null) {
    serialized.actual = details.actual;
  }
  if (typeof details.limit === "number" || details.limit === null) {
    serialized.limit = details.limit;
  }
  return serialized;
}

export function deserializeOfficeTextFallbackError(
  serialized: SerializedOfficeTextFallbackError,
): Error {
  let error: Error;
  if (
    serialized.name === "OfficeTextFallbackError"
    && isOfficeTextFallbackErrorCode(serialized.code)
  ) {
    error = new OfficeTextFallbackError(serialized.code, serialized.message, {
      entryName: serialized.entryName,
      actual: serialized.actual,
      limit: serialized.limit,
    });
  } else {
    error = new Error(serialized.message);
    error.name = serialized.name;
    const target = error as Error & Record<string, unknown>;
    if (serialized.code !== undefined) target.code = serialized.code;
    if (serialized.entryName !== undefined) target.entryName = serialized.entryName;
    if (serialized.actual !== undefined) target.actual = serialized.actual;
    if (serialized.limit !== undefined) target.limit = serialized.limit;
  }
  if (serialized.stack) error.stack = serialized.stack;
  return error;
}

async function extractPresentationText(
  arrayBuffer: ArrayBuffer,
  zip: JSZip,
  overrides: Partial<PresentationTextExtractionBudget> | undefined,
): Promise<PresentationTextFallbackResult> {
  const budget = resolvePresentationBudget(overrides);
  const slideEntries = Object.values(zip.files)
    .filter((entry): entry is StreamableZipObject => (
      !entry.dir && /^ppt\/slides\/slide\d+\.xml$/i.test(entry.name)
    ))
    .sort((left, right) => getSlideNumber(left.name) - getSlideNumber(right.name));

  if (slideEntries.length === 0) {
    throw new OfficeTextFallbackError(
      "missing-presentation-slides",
      "The presentation package does not contain readable slide XML.",
    );
  }

  const selectedEntries = slideEntries.slice(0, budget.maxSlides);
  const byteTotals = { actual: 0 };
  const slides: PresentationFallbackSlide[] = [];
  let totalOutputLines = 0;

  // Intentionally sequential: never inflate more than one slide at a time.
  for (let position = 0; position < selectedEntries.length; position += 1) {
    const entry = selectedEntries[position];
    const { text: xml } = await readBoundedZipEntryText(entry, {
      entryLimit: budget.maxSlideXmlBytes,
      totalLimit: budget.maxTotalXmlBytes,
      byteTotals,
    });
    const candidates = parseXmlTextCandidates(
      xml,
      entry.name,
      budget.maxLinesPerSlide + 1,
    );
    const selected = selectPreferredTextLines(candidates);

    if (selected.overflow || selected.lines.length > budget.maxLinesPerSlide) {
      throw new OfficeTextFallbackError(
        "output-line-limit",
        `Slide XML ${entry.name} exceeds the per-slide text line budget.`,
        {
          entryName: entry.name,
          actual: Math.max(selected.lines.length, budget.maxLinesPerSlide + 1),
          limit: budget.maxLinesPerSlide,
        },
      );
    }

    const slideOutputLines = Math.max(1, selected.lines.length);
    totalOutputLines = checkedAdd(totalOutputLines, slideOutputLines, entry.name);
    if (totalOutputLines > budget.maxTotalLines) {
      throw new OfficeTextFallbackError(
        "output-line-limit",
        "The presentation text fallback exceeds its total output line budget.",
        {
          entryName: entry.name,
          actual: totalOutputLines,
          limit: budget.maxTotalLines,
        },
      );
    }

    const [title, ...lines] = selected.lines;
    slides.push({
      index: position + 1,
      title: title || null,
      lines,
    });

  }

  return {
    operation: "extract-presentation-text",
    arrayBuffer,
    slides,
    report: {
      sourceSlideCount: slideEntries.length,
      extractedSlideCount: slides.length,
      truncatedSlideCount: slideEntries.length - slides.length,
      totalXmlBytes: byteTotals.actual,
      totalOutputLines,
    },
  };
}

async function extractOpenDocumentText(
  arrayBuffer: ArrayBuffer,
  zip: JSZip,
  overrides: Partial<OpenDocumentTextExtractionBudget> | undefined,
): Promise<OpenDocumentTextFallbackResult> {
  const budget = resolveOpenDocumentBudget(overrides);
  const entry = zip.files["content.xml"] as StreamableZipObject | undefined;
  if (!entry || entry.dir) {
    throw new OfficeTextFallbackError(
      "missing-content-xml",
      "The OpenDocument package does not contain readable content.xml.",
      { entryName: "content.xml" },
    );
  }

  const byteTotals = { actual: 0 };
  const { text: xml, actualBytes } = await readBoundedZipEntryText(entry, {
    entryLimit: budget.maxContentXmlBytes,
    totalLimit: budget.maxContentXmlBytes,
    byteTotals,
  });
  const candidates = parseXmlTextCandidates(xml, entry.name, budget.maxLines + 1);
  const selected = selectPreferredTextLines(candidates);
  const truncatedLines = selected.overflow || selected.lines.length > budget.maxLines;
  const lines = selected.lines.slice(0, budget.maxLines);

  return {
    operation: "extract-opendocument-text",
    arrayBuffer,
    lines,
    report: {
      contentXmlBytes: actualBytes,
      outputLines: lines.length,
      truncatedLines,
    },
  };
}

function readBoundedZipEntryText(
  entry: StreamableZipObject,
  {
    entryLimit,
    totalLimit,
    byteTotals,
  }: {
    entryLimit: number;
    totalLimit: number;
    byteTotals: { actual: number };
  },
): Promise<{ text: string; actualBytes: number }> {
  return new Promise((resolve, reject) => {
    const stream = entry.internalStream("uint8array");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const textChunks: string[] = [];
    let actualBytes = 0;
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
        actualBytes = checkedAdd(actualBytes, chunk.byteLength, entry.name);
        byteTotals.actual = checkedAdd(byteTotals.actual, chunk.byteLength, entry.name);
        if (actualBytes > entryLimit) {
          throw new OfficeTextFallbackError(
            "entry-xml-size-limit",
            `XML entry ${entry.name} exceeds the text fallback byte budget.`,
            { entryName: entry.name, actual: actualBytes, limit: entryLimit },
          );
        }
        if (byteTotals.actual > totalLimit) {
          throw new OfficeTextFallbackError(
            "total-xml-size-limit",
            "The Office text fallback exceeds its total XML byte budget.",
            { entryName: entry.name, actual: byteTotals.actual, limit: totalLimit },
          );
        }
        textChunks.push(decoder.decode(chunk, { stream: true }));
      } catch (error) {
        fail(normalizeXmlReadError(error, entry.name));
      }
    });
    stream.on("error", (error) => fail(error));
    stream.on("end", () => {
      if (settled) return;
      try {
        textChunks.push(decoder.decode());
        settled = true;
        resolve({ text: textChunks.join(""), actualBytes });
      } catch (error) {
        fail(normalizeXmlReadError(error, entry.name));
      }
    });
    stream.resume();
  });
}

function parseXmlTextCandidates(
  xml: string,
  entryName: string,
  storageLimit: number,
): XmlTextCandidates {
  const paragraphs = createLineCollector(storageLimit);
  const textRuns = createLineCollector(storageLimit);
  const frames: XmlFrame[] = [];
  const activeCaptures: XmlCapture[] = [];
  let cursor = 0;
  let rootSeen = false;
  let rootClosed = false;
  let startTagCount = 0;

  const appendText = (raw: string, decodeEntities: boolean) => {
    if (!raw) return;
    if (frames.length === 0) {
      if (raw.replace(/^\uFEFF/, "").trim()) throwMalformedXml(entryName);
      return;
    }
    const value = decodeEntities ? decodeXmlEntities(raw, entryName) : raw;
    if (activeCaptures.length === 0) return;
    for (const capture of activeCaptures) capture.parts.push(value);
  };

  while (cursor < xml.length) {
    const open = xml.indexOf("<", cursor);
    if (open < 0) {
      appendText(xml.slice(cursor), true);
      cursor = xml.length;
      break;
    }
    appendText(xml.slice(cursor, open), true);

    if (xml.startsWith("<!--", open)) {
      const end = xml.indexOf("-->", open + 4);
      if (end < 0) throwMalformedXml(entryName);
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", open)) {
      const end = xml.indexOf("]]>", open + 9);
      if (end < 0) throwMalformedXml(entryName);
      appendText(xml.slice(open + 9, end), false);
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<?", open)) {
      const end = xml.indexOf("?>", open + 2);
      if (end < 0) throwMalformedXml(entryName);
      cursor = end + 2;
      continue;
    }
    if (xml.startsWith("<!", open)) {
      // DTD/entity declarations are unnecessary for Office XML and unsafe for
      // a text-only fallback, so reject them instead of attempting expansion.
      throwMalformedXml(entryName);
    }

    const close = findXmlTagEnd(xml, open + 1);
    if (close < 0) throwMalformedXml(entryName);
    const token = xml.slice(open + 1, close);

    if (token.startsWith("/")) {
      const closingName = parseClosingTagName(token.slice(1), entryName);
      const frame = frames.pop();
      if (!frame || frame.name !== closingName) throwMalformedXml(entryName);
      if (frame.capture) {
        const active = activeCaptures.pop();
        if (active !== frame.capture) throwMalformedXml(entryName);
        finishXmlCapture(frame.capture, paragraphs, textRuns);
      }
      if (frames.length === 0) rootClosed = true;
      cursor = close + 1;
      continue;
    }

    const { name, selfClosing } = parseOpeningTag(token, entryName);
    if (frames.length === 0) {
      if (rootSeen || rootClosed) throwMalformedXml(entryName);
      rootSeen = true;
    }
    startTagCount += 1;
    if (startTagCount > MAX_XML_START_TAGS || frames.length >= MAX_XML_NESTING_DEPTH) {
      throwMalformedXml(entryName);
    }

    const localName = getXmlLocalName(name);
    const capture = localName === "p" || localName === "t"
      ? { kind: localName, parts: [] } satisfies XmlCapture
      : null;
    if (capture) {
      const collector = capture.kind === "p" ? paragraphs : textRuns;
      collector.elementCount += 1;
    }

    if (selfClosing) {
      if (capture) finishXmlCapture(capture, paragraphs, textRuns);
      if (frames.length === 0) rootClosed = true;
    } else {
      const frame = { name, capture };
      frames.push(frame);
      if (capture) activeCaptures.push(capture);
    }
    cursor = close + 1;
  }

  if (!rootSeen || frames.length !== 0) throwMalformedXml(entryName);
  return { paragraphs, textRuns };
}

function createLineCollector(storageLimit: number): XmlLineCollector {
  return { elementCount: 0, lines: [], overflow: false, storageLimit };
}

function finishXmlCapture(
  capture: XmlCapture,
  paragraphs: XmlLineCollector,
  textRuns: XmlLineCollector,
): void {
  const line = capture.parts.join("").replace(/\s+/g, " ").trim();
  if (!line) return;
  const collector = capture.kind === "p" ? paragraphs : textRuns;
  if (collector.lines[collector.lines.length - 1] === line) return;
  if (collector.lines.length >= collector.storageLimit) {
    collector.overflow = true;
    return;
  }
  collector.lines.push(line);
}

function selectPreferredTextLines(candidates: XmlTextCandidates): XmlLineCollector {
  return candidates.paragraphs.elementCount > 0 ? candidates.paragraphs : candidates.textRuns;
}

function findXmlTagEnd(xml: string, start: number): number {
  let quote: "\"" | "'" | null = null;
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === "<") return -1;
      if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "<") return -1;
    if (character === ">") return index;
  }
  return -1;
}

function parseOpeningTag(
  token: string,
  entryName: string,
): { name: string; selfClosing: boolean } {
  const nameMatch = /^([A-Za-z_:][A-Za-z0-9_.:-]*)/.exec(token);
  if (!nameMatch) throwMalformedXml(entryName);
  const remainder = token.slice(nameMatch[0].length);
  const selfClosing = /\/\s*$/.test(remainder);
  const withoutSlash = selfClosing ? remainder.replace(/\/\s*$/, "") : remainder;
  if (withoutSlash && !/^\s/.test(withoutSlash)) throwMalformedXml(entryName);
  validateXmlAttributes(withoutSlash, entryName);
  return { name: nameMatch[1], selfClosing };
}

function parseClosingTagName(token: string, entryName: string): string {
  const match = /^([A-Za-z_:][A-Za-z0-9_.:-]*)\s*$/.exec(token);
  if (!match) throwMalformedXml(entryName);
  return match[1];
}

function validateXmlAttributes(source: string, entryName: string): void {
  let cursor = 0;
  const names = new Set<string>();
  while (cursor < source.length) {
    const whitespaceStart = cursor;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (cursor === source.length) return;
    if (cursor === whitespaceStart) throwMalformedXml(entryName);

    const nameMatch = /^([A-Za-z_:][A-Za-z0-9_.:-]*)/.exec(source.slice(cursor));
    if (!nameMatch || names.has(nameMatch[1])) throwMalformedXml(entryName);
    names.add(nameMatch[1]);
    cursor += nameMatch[0].length;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] !== "=") throwMalformedXml(entryName);
    cursor += 1;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;

    const quote = source[cursor];
    if (quote !== "\"" && quote !== "'") throwMalformedXml(entryName);
    const valueStart = cursor + 1;
    const valueEnd = source.indexOf(quote, valueStart);
    if (valueEnd < 0) throwMalformedXml(entryName);
    decodeXmlEntities(source.slice(valueStart, valueEnd), entryName);
    cursor = valueEnd + 1;
  }
}

function getXmlLocalName(name: string): string {
  const separator = name.lastIndexOf(":");
  return separator < 0 ? name : name.slice(separator + 1);
}

function decodeXmlEntities(text: string, entryName: string): string {
  if (!text.includes("&")) return text;
  let result = "";
  let cursor = 0;
  while (cursor < text.length) {
    const ampersand = text.indexOf("&", cursor);
    if (ampersand < 0) return result + text.slice(cursor);
    result += text.slice(cursor, ampersand);
    const semicolon = text.indexOf(";", ampersand + 1);
    if (semicolon < 0) throwMalformedXml(entryName);
    const entity = text.slice(ampersand + 1, semicolon);
    result += decodeXmlEntity(entity, entryName);
    cursor = semicolon + 1;
  }
  return result;
}

function decodeXmlEntity(entity: string, entryName: string): string {
  if (entity === "amp") return "&";
  if (entity === "lt") return "<";
  if (entity === "gt") return ">";
  if (entity === "quot") return "\"";
  if (entity === "apos") return "'";

  let codePoint: number;
  if (/^#\d+$/.test(entity)) {
    codePoint = Number(entity.slice(1));
  } else if (/^#x[0-9a-f]+$/i.test(entity)) {
    codePoint = Number.parseInt(entity.slice(2), 16);
  } else {
    throwMalformedXml(entryName);
  }
  if (!isValidXmlCodePoint(codePoint)) throwMalformedXml(entryName);
  return String.fromCodePoint(codePoint);
}

function isValidXmlCodePoint(value: number): boolean {
  return value === 0x09
    || value === 0x0a
    || value === 0x0d
    || (value >= 0x20 && value <= 0xd7ff)
    || (value >= 0xe000 && value <= 0xfffd)
    || (value >= 0x10000 && value <= 0x10ffff);
}

function throwMalformedXml(entryName: string): never {
  throw new OfficeTextFallbackError(
    "malformed-xml",
    `XML entry ${entryName} is malformed or uses unsupported declarations.`,
    { entryName },
  );
}

function normalizeXmlReadError(error: unknown, entryName: string): unknown {
  if (error instanceof OfficeTextFallbackError) return error;
  if (error instanceof TypeError) {
    return new OfficeTextFallbackError(
      "malformed-xml",
      `XML entry ${entryName} is not valid UTF-8 text.`,
      { entryName },
    );
  }
  return error;
}

function resolvePresentationBudget(
  overrides: Partial<PresentationTextExtractionBudget> | undefined,
): PresentationTextExtractionBudget {
  const budget = { ...DEFAULT_PRESENTATION_TEXT_EXTRACTION_BUDGET, ...overrides };
  assertPositiveSafeInteger("maxSlides", budget.maxSlides);
  if (budget.maxSlides > MAX_PRESENTATION_TEXT_SLIDES) {
    throw new RangeError(`maxSlides cannot exceed ${MAX_PRESENTATION_TEXT_SLIDES}.`);
  }
  assertPositiveSafeInteger("maxSlideXmlBytes", budget.maxSlideXmlBytes);
  assertPositiveSafeInteger("maxTotalXmlBytes", budget.maxTotalXmlBytes);
  assertPositiveSafeInteger("maxLinesPerSlide", budget.maxLinesPerSlide);
  assertPositiveSafeInteger("maxTotalLines", budget.maxTotalLines);
  return budget;
}

function resolveOpenDocumentBudget(
  overrides: Partial<OpenDocumentTextExtractionBudget> | undefined,
): OpenDocumentTextExtractionBudget {
  const budget = { ...DEFAULT_OPEN_DOCUMENT_TEXT_EXTRACTION_BUDGET, ...overrides };
  assertPositiveSafeInteger("maxContentXmlBytes", budget.maxContentXmlBytes);
  assertPositiveSafeInteger("maxLines", budget.maxLines);
  if (budget.maxLines > MAX_OPEN_DOCUMENT_TEXT_LINES) {
    throw new RangeError(`maxLines cannot exceed ${MAX_OPEN_DOCUMENT_TEXT_LINES}.`);
  }
  return budget;
}

function assertPositiveSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

function checkedAdd(left: number, right: number, entryName: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) {
    throw new OfficeTextFallbackError(
      "total-xml-size-limit",
      "Office text fallback counters exceeded the safe integer range.",
      { entryName },
    );
  }
  return value;
}

function getSlideNumber(name: string): number {
  const match = /slide(\d+)\.xml$/i.exec(name);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function isOfficeTextFallbackErrorCode(value: string | undefined): value is OfficeTextFallbackErrorCode {
  return value === "missing-presentation-slides"
    || value === "missing-content-xml"
    || value === "entry-xml-size-limit"
    || value === "total-xml-size-limit"
    || value === "output-line-limit"
    || value === "malformed-xml";
}
