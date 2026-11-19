import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = path.join(repoRoot, "dist", "assets");
const entryChunkBudgetBytes = 1_950_000;
const heavyChunks = [
  {
    label: "docx-preview",
    chunkPattern: /^docx-preview-.+\.js$/,
    entryLeakPattern: /schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/officeDocument/,
  },
  {
    label: "jszip",
    chunkPattern: /^jszip(?:\.min)?-.+\.js$/,
    entryLeakPattern: /\b(?:function JSZip|JSZip\.support|JSZip\.defaults)\b/,
  },
  {
    label: "DOCX redline worker",
    chunkPattern: /^docxRedline\.worker-.+\.js$/,
    chunkContentPattern: /Word document XML is malformed/,
    entryLeakPattern: /Word document XML is malformed/,
  },
  {
    label: "xlsx",
    chunkPattern: /^xlsx-.+\.js$/,
    entryLeakPattern: /\bSheetJS\b/,
  },
  {
    label: "mermaid",
    chunkPattern: /^mermaid\.core-.+\.js$/,
    entryLeakPattern: /\bmermaidAPI\b/,
  },
  {
    label: "pptx-renderer",
    chunkPattern: /^(?:aiden0z-)?pptx-renderer(?:\.es)?-.+\.js$/,
    chunkContentPattern: /data-pptx-background-gradient/,
    entryLeakPattern: /data-pptx-background-gradient/,
  },
];
const rendererLocales = ["en", "es", "pt-BR", "fr", "de", "ja", "ko", "zh-Hans"];

const files = readdirSync(assetsDir);
const entryChunks = files.filter((fileName) => /^index-.+\.js$/.test(fileName));

if (entryChunks.length !== 1) {
  fail(`expected exactly one renderer entry chunk, found ${entryChunks.length}`);
}

const entryChunk = entryChunks[0];
const entryPath = path.join(assetsDir, entryChunk);
const entrySize = statSync(entryPath).size;
const entrySource = readFileSync(entryPath, "utf8");
const lazyChunkSources = new Map();
const errors = [];

if (entrySize > entryChunkBudgetBytes) {
  errors.push(
    `${entryChunk} is ${formatBytes(entrySize)}, above the ${formatBytes(entryChunkBudgetBytes)} entry chunk budget`,
  );
}

for (const heavyChunk of heavyChunks) {
  const hasNamedChunk = files.some((fileName) => heavyChunk.chunkPattern.test(fileName));
  const hasContentMatchedChunk = heavyChunk.chunkContentPattern
    ? files.some((fileName) => (
      fileName !== entryChunk
      && fileName.endsWith(".js")
      && heavyChunk.chunkContentPattern.test(readLazyChunkSource(fileName))
    ))
    : false;
  if (!hasNamedChunk && !hasContentMatchedChunk) {
    errors.push(`${heavyChunk.label} did not build as a separate lazy chunk`);
  }
  if (heavyChunk.entryLeakPattern.test(entrySource)) {
    errors.push(`${heavyChunk.label} implementation leaked into ${entryChunk}`);
  }
}

const localeChunks = new Set();
for (const locale of rendererLocales) {
  const onboardingCatalog = JSON.parse(readFileSync(
    path.join(repoRoot, "locales", "renderer", locale, "onboarding.json"),
    "utf8",
  ));
  const sentinel = onboardingCatalog["error.folderPathUnreadable"];
  if (typeof sentinel !== "string" || sentinel.length < 20) {
    errors.push(`${locale} locale bundle sentinel is missing or too short`);
    continue;
  }
  if (entrySource.includes(sentinel)) {
    errors.push(`${locale} renderer catalog leaked into ${entryChunk}`);
  }
  const matchingChunks = files.filter((fileName) => (
    fileName !== entryChunk
    && fileName.endsWith(".js")
    && readLazyChunkSource(fileName).includes(sentinel)
  ));
  if (matchingChunks.length !== 1) {
    errors.push(
      `${locale} renderer catalog must exist in exactly one lazy chunk; found ${matchingChunks.length}`,
    );
    continue;
  }
  localeChunks.add(matchingChunks[0]);
}

if (localeChunks.size !== rendererLocales.length) {
  errors.push(
    `expected ${rendererLocales.length} independently lazy renderer locale chunks, found ${localeChunks.size}`,
  );
}

if (errors.length > 0) {
  console.error("bundle budget check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `bundle budget check passed: ${entryChunk} is ${formatBytes(entrySize)}; `
  + `${localeChunks.size} renderer locale chunks are lazy.`,
);

function fail(message) {
  console.error(`bundle budget check failed: ${message}`);
  process.exit(1);
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function readLazyChunkSource(fileName) {
  let source = lazyChunkSources.get(fileName);
  if (source === undefined) {
    source = readFileSync(path.join(assetsDir, fileName), "utf8");
    lazyChunkSources.set(fileName, source);
  }
  return source;
}
