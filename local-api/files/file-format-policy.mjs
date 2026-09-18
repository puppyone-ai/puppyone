import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const localApiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fileFormatRegistry = loadFileFormatRegistry();
const unknownFormat = fileFormatRegistry.unknownFormat;
const mimeTypeByExtension = new Map(Object.entries({
  "3g2": "video/3gpp2",
  "3gp": "video/3gpp",
  "3gpp": "video/3gpp",
  "7z": "application/x-7z-compressed",
  aac: "audio/aac",
  aif: "audio/aiff",
  aifc: "audio/aiff",
  aiff: "audio/aiff",
  apng: "image/apng",
  avi: "video/x-msvideo",
  avif: "image/avif",
  azw: "application/x-mobipocket-ebook",
  azw3: "application/x-mobipocket-ebook",
  bmp: "image/bmp",
  bz: "application/x-bzip2",
  bz2: "application/x-bzip2",
  cer: "application/pkix-cert",
  cr2: "image/x-canon-cr2",
  crt: "application/x-x509-ca-cert",
  css: "text/css",
  csv: "text/csv",
  db: "application/octet-stream",
  db3: "application/octet-stream",
  duckdb: "application/vnd.duckdb",
  ddb: "application/vnd.duckdb",
  der: "application/pkix-cert",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  eot: "application/vnd.ms-fontobject",
  epub: "application/epub+zip",
  flac: "audio/flac",
  flv: "video/x-flv",
  gif: "image/gif",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  gz: "application/gzip",
  heic: "image/heic",
  heif: "image/heif",
  htm: "text/html",
  html: "text/html",
  ico: "image/x-icon",
  img: "application/x-iso9660-image",
  ipynb: "application/x-ipynb+json",
  iso: "application/x-iso9660-image",
  jpe: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  jpg: "image/jpeg",
  js: "application/javascript",
  json: "application/json",
  json5: "application/json",
  jsonc: "application/json",
  jsonl: "application/x-ndjson",
  key: "application/x-pem-file",
  lzma: "application/x-lzma",
  m2v: "video/mpeg",
  m4a: "audio/mp4",
  m4b: "audio/mp4",
  m4v: "video/mp4",
  md: "text/markdown",
  markdown: "text/markdown",
  mdx: "text/markdown",
  mid: "audio/midi",
  midi: "audio/midi",
  mkv: "video/x-matroska",
  mobi: "application/x-mobipocket-ebook",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mpe: "video/mpeg",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  ndjson: "application/x-ndjson",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  ogv: "video/ogg",
  opus: "audio/opus",
  otf: "font/otf",
  p12: "application/x-pkcs12",
  pdf: "application/pdf",
  pem: "application/x-pem-file",
  pfx: "application/x-pkcs12",
  pjp: "image/jpeg",
  pjpeg: "image/jpeg",
  png: "image/png",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  puppyflow: "application/vnd.puppyone.puppyflow+json",
  "puppyflow.json": "application/vnd.puppyone.puppyflow+json",
  psd: "image/vnd.adobe.photoshop",
  qt: "video/quicktime",
  rar: "application/vnd.rar",
  rtf: "application/rtf",
  sqlite: "application/vnd.sqlite3",
  sqlite3: "application/vnd.sqlite3",
  stl: "model/stl",
  svg: "image/svg+xml",
  tar: "application/x-tar",
  "tar.bz2": "application/x-bzip2",
  "tar.gz": "application/gzip",
  "tar.xz": "application/x-xz",
  tbz: "application/x-bzip2",
  tbz2: "application/x-bzip2",
  tgz: "application/gzip",
  tif: "image/tiff",
  tiff: "image/tiff",
  tsv: "text/tab-separated-values",
  ttc: "font/ttf",
  ttf: "font/ttf",
  txz: "application/x-xz",
  wav: "audio/wav",
  wave: "audio/wav",
  weba: "audio/webm",
  webm: "video/webm",
  webp: "image/webp",
  wma: "audio/x-ms-wma",
  wmv: "video/x-ms-wmv",
  woff: "font/woff",
  woff2: "font/woff2",
  xhtml: "text/html",
  xls: "application/vnd.ms-excel",
  xlsb: "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml: "application/xml",
  xz: "application/x-xz",
  zip: "application/zip",
}));
const mimeOverrideExtensions = [...mimeTypeByExtension.keys()].sort((left, right) => right.length - left.length);
const filenameIndex = new Map();
const extensionIndex = new Map();
const mimeIndex = new Map();
const filenamePatterns = [];

for (const format of fileFormatRegistry.formats) {
  for (const filename of format.filenames ?? []) {
    filenameIndex.set(filename.toLowerCase(), format);
  }
  for (const pattern of format.filenamePatterns ?? []) {
    filenamePatterns.push({
      regex: globPatternToRegExp(pattern.toLowerCase()),
      format,
    });
  }
  for (const extension of format.extensions ?? []) {
    extensionIndex.set(extension.toLowerCase(), format);
  }
  for (const mimeType of format.mimeTypes ?? []) {
    mimeIndex.set(mimeType.toLowerCase(), format);
  }
}

const copyNameExtensions = [...extensionIndex.keys()].sort((left, right) => right.length - left.length);

export function getMimeType(filePath) {
  const format = resolveLocalFileFormat({ name: filePath });
  const mimeType = getRegistryMimeTypeForName(format, filePath)
    ?? getMimeTypeOverride(filePath)
    ?? format.mimeTypes?.[0]
    ?? null;
  if (!mimeType) return null;
  return shouldUseUtf8Mime(format, mimeType) ? `${mimeType}; charset=utf-8` : mimeType;
}

export function classifyLocalFile(name) {
  return getSemanticKindForFormat(resolveLocalFileFormat({ name }));
}

export function isLocalFilePreviewable(filePath) {
  return isTextLikeFormat(resolveLocalFileFormat({ name: filePath }));
}

export function resolveCopyNameExtension(name) {
  const lowerName = name.toLowerCase();
  const registeredExtension = copyNameExtensions.find((extension) => (
    lowerName.endsWith(extension) && name.length > extension.length
  ));
  if (registeredExtension) {
    return name.slice(-registeredExtension.length);
  }

  const lastDot = name.lastIndexOf(".");
  return lastDot > 0 ? name.slice(lastDot) : "";
}

function loadFileFormatRegistry() {
  const registryPath = path.resolve(localApiDir, "../packages/shared-ui/src/core/fileFormats.json");
  try {
    return JSON.parse(readFileSync(registryPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to load PuppyOne file format registry from ${registryPath}: ${error.message}`,
    );
  }
}

function resolveLocalFileFormat({ name, mimeType }) {
  if (name) {
    const base = path.basename(name).toLowerCase();
    const byName = filenameIndex.get(base);
    if (byName) return byName;

    const byExtension = matchExtension(name);
    if (byExtension) return byExtension;

    const byPattern = matchFilenamePattern(name);
    if (byPattern) return byPattern;
  }

  if (mimeType) {
    const normalizedMime = mimeType.toLowerCase().split(";")[0].trim();
    const byMime = mimeIndex.get(normalizedMime);
    if (byMime) return byMime;

    if (normalizedMime.startsWith("image/")) {
      return {
        ...unknownFormat,
        id: "image-unknown",
        label: "Image",
        category: "image",
        defaultViewer: "image-preview",
      };
    }

    if (
      normalizedMime.startsWith("text/") ||
      normalizedMime === "application/javascript" ||
      normalizedMime === "application/typescript"
    ) {
      return {
        ...unknownFormat,
        id: "text-unknown",
        label: "Text",
        category: "text",
        defaultViewer: "plain-text",
        editable: true,
        monacoLanguage: "plaintext",
      };
    }
  }

  return unknownFormat;
}

function getRegistryMimeTypeForName(format, name) {
  const lowerName = path.basename(name).toLowerCase();
  const extension = [...(format.extensions ?? [])]
    .map((value) => value.toLowerCase())
    .sort((left, right) => right.length - left.length)
    .find((value) => lowerName.endsWith(value));
  return extension ? format.mimeTypesByExtension?.[extension] ?? null : null;
}

function matchExtension(name) {
  const lower = path.basename(name).toLowerCase();
  const lastDot = lower.lastIndexOf(".");
  if (lastDot < 0) return null;

  const secondLastDot = lower.lastIndexOf(".", lastDot - 1);
  if (secondLastDot >= 0) {
    const compound = lower.slice(secondLastDot);
    const compoundMatch = extensionIndex.get(compound);
    if (compoundMatch) return compoundMatch;
  }

  return extensionIndex.get(lower.slice(lastDot)) ?? null;
}

function matchFilenamePattern(name) {
  const normalized = String(name).replace(/\\/g, "/").toLowerCase();
  const base = path.basename(normalized);

  for (const { regex, format } of filenamePatterns) {
    if (regex.test(normalized) || regex.test(base)) return format;
  }

  return null;
}

function globPatternToRegExp(pattern) {
  let source = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    const afterNext = pattern[index + 2];

    if (char === "*" && next === "*" && afterNext === "/") {
      source += "(?:.*/)?";
      index += 2;
      continue;
    }

    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegExp(char);
  }

  return new RegExp(`${source}$`);
}

function escapeRegExp(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function getMimeTypeOverride(name) {
  const lower = path.basename(name).toLowerCase();
  for (const extension of mimeOverrideExtensions) {
    if (lower.endsWith(`.${extension}`)) {
      return mimeTypeByExtension.get(extension) ?? null;
    }
  }
  return null;
}

function getSemanticKindForFormat(format) {
  if (format.id === "puppyflow") return "workflow";
  if (format.id === "json" || format.id === "jsonl") return "json";

  switch (format.defaultViewer) {
    case "markdown-editor":
      return "markdown";
    case "html-artifact":
      return "html";
    case "app-preview":
      return "app";
    case "image-preview":
      return "image";
    case "audio-preview":
      return "audio";
    case "video-preview":
      return "video";
    case "pdf-preview":
      return "pdf";
    case "csv-table":
      return "spreadsheet";
    default:
      break;
  }

  switch (format.category) {
    case "markdown":
      return "markdown";
    case "app":
      return "app";
    case "image":
      return "image";
    case "audio":
      return "audio";
    case "video":
      return "video";
    case "archive":
      return "archive";
    case "document":
      return format.id === "xlsx" ? "spreadsheet" : "document";
    case "binary":
      return "binary";
    case "text":
      return "text";
    case "code":
    case "data":
      return "code";
    default:
      return "file";
  }
}

function isTextLikeFormat(format) {
  return (
    format.category === "markdown" ||
    format.category === "text" ||
    format.category === "code" ||
    format.defaultViewer === "csv-table" ||
    (format.category === "data" && format.defaultViewer === "monaco-code")
  );
}

function shouldUseUtf8Mime(format, mimeType) {
  return (
    mimeType.startsWith("text/") ||
    format.category === "markdown" ||
    format.category === "text" ||
    format.category === "code" ||
    format.category === "data" ||
    format.defaultViewer === "html-artifact" ||
    format.defaultViewer === "monaco-code" ||
    format.defaultViewer === "csv-table" ||
    format.defaultViewer === "plain-text"
  );
}
