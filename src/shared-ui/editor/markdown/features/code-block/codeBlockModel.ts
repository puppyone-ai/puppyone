import type { EditorState } from "@codemirror/state";
import type { MarkdownCodeSourceReference } from "../../core/features/markdownFeatureData";

export type { MarkdownCodeSourceReference } from "../../core/features/markdownFeatureData";

export type MarkdownCodeBlock = {
  from: number;
  to: number;
  nextLineNumber: number;
  language: string;
  sourceReference: MarkdownCodeSourceReference | null;
  code: string;
};

export type MarkdownCodeFenceInfo = {
  language: string;
  sourceReference: MarkdownCodeSourceReference | null;
};

const CODE_LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  bash: "bash",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cts: "typescript",
  cxx: "cpp",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  fs: "fsharp",
  fsx: "fsharp",
  go: "go",
  h: "c",
  hpp: "cpp",
  htm: "html",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "jsx",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  lua: "lua",
  md: "markdown",
  mdx: "mdx",
  mjs: "javascript",
  mmd: "mermaid",
  mts: "typescript",
  php: "php",
  pl: "perl",
  proto: "protobuf",
  py: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  sass: "sass",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svelte: "svelte",
  swift: "swift",
  tex: "latex",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  txt: "text",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

export function getMarkdownCodeBlock(state: EditorState, lineNumber: number): MarkdownCodeBlock | null {
  const doc = state.doc;
  const openingLine = doc.line(lineNumber);
  const openingMatch = /^(\s*)(`{3,}|~{3,})([^\n]*)$/.exec(openingLine.text);
  if (!openingMatch) return null;

  const fence = openingMatch[2];
  const fenceCharacter = fence[0];
  if (fenceCharacter === "`" && openingMatch[3].includes("`")) return null;
  const minimumFenceLength = fence.length;
  const info = parseMarkdownCodeFenceInfo(openingMatch[3]);
  const codeLines: string[] = [];
  let closingLine = openingLine;
  let nextLineNumber = lineNumber + 1;

  while (nextLineNumber <= doc.lines) {
    const line = doc.line(nextLineNumber);
    const closingPattern = new RegExp(`^\\s*\\${fenceCharacter}{${minimumFenceLength},}\\s*$`);
    if (closingPattern.test(line.text)) {
      closingLine = line;
      nextLineNumber += 1;
      break;
    }

    codeLines.push(line.text);
    closingLine = line;
    nextLineNumber += 1;
  }

  return {
    from: openingLine.from,
    to: closingLine.to,
    nextLineNumber,
    language: info.language,
    sourceReference: info.sourceReference,
    code: codeLines.join("\n"),
  };
}

export function parseMarkdownCodeFenceInfo(value: string): MarkdownCodeFenceInfo {
  const infoString = value.trim();
  if (!infoString) return { language: "", sourceReference: null };

  const legacyReference = /^(\d+):(\d+):(.+)$/.exec(infoString);
  if (legacyReference) {
    const sourceReference = createCodeSourceReference(
      legacyReference[3],
      Number(legacyReference[1]),
      Number(legacyReference[2]),
    );
    if (sourceReference) {
      return {
        language: inferCodeLanguageFromPath(sourceReference.path),
        sourceReference,
      };
    }
  }

  const firstToken = /^\S+/.exec(infoString)?.[0] ?? "";
  const sourcePath = readFenceInfoAttribute(infoString, ["file", "source", "path"]);
  const lineRange = parseCodeLineRange(readFenceInfoAttribute(infoString, ["lines"]));
  const sourceReference = sourcePath && lineRange
    ? createCodeSourceReference(sourcePath, lineRange.startLine, lineRange.endLine)
    : null;
  const explicitLanguage = firstToken.includes("=") ? "" : firstToken;

  return {
    language: explicitLanguage || (sourceReference ? inferCodeLanguageFromPath(sourceReference.path) : ""),
    sourceReference,
  };
}

export function isMermaidCodeBlockLanguage(language: string): boolean {
  const normalized = language.trim().toLowerCase();
  return normalized === "mermaid" || normalized === "mmd";
}

export function serializeMarkdownCodeBlock(
  language: string,
  code: string,
  options: { sourceReference?: MarkdownCodeSourceReference | null } = {},
): string {
  const sourceReference = options.sourceReference
    ? createCodeSourceReference(
        options.sourceReference.path,
        options.sourceReference.startLine,
        options.sourceReference.endLine,
      )
    : null;
  const resolvedLanguage = sanitizeCodeLanguage(language) || (
    sourceReference ? inferCodeLanguageFromPath(sourceReference.path) : ""
  );
  const infoString = sourceReference
    ? serializeCodeFenceInfo(resolvedLanguage, sourceReference)
    : resolvedLanguage;
  const fenceCharacter = infoString.includes("`") ? "~" : "`";
  const fenceRuns = fenceCharacter === "`" ? /`+/g : /~+/g;
  const longestFence = Math.max(2, ...Array.from(code.matchAll(fenceRuns), (match) => match[0].length));
  const fence = fenceCharacter.repeat(Math.max(3, longestFence + 1));
  const info = infoString ? `${fence}${infoString}` : fence;
  return `${info}\n${code}\n${fence}`;
}

export function sanitizeCodeLanguage(value: string): string {
  return value.trim().replace(/\s+/g, "-").replace(/[`~]/g, "");
}

export function inferCodeLanguageFromPath(path: string): string {
  const fileName = path.trim().split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (!fileName) return "";
  if (fileName === "dockerfile") return "dockerfile";
  if (fileName === "makefile") return "makefile";
  const extensionIndex = fileName.lastIndexOf(".");
  if (extensionIndex < 0 || extensionIndex === fileName.length - 1) return "";
  const extension = fileName.slice(extensionIndex + 1);
  return CODE_LANGUAGE_BY_EXTENSION[extension] ?? (/^[a-z0-9+#-]{1,16}$/.test(extension) ? extension : "");
}

export function formatMarkdownCodeSourceReference(reference: MarkdownCodeSourceReference): string {
  const lineLabel = reference.startLine === reference.endLine
    ? `L${reference.startLine}`
    : `L${reference.startLine}–${reference.endLine}`;
  return `${reference.path} · ${lineLabel}`;
}

function createCodeSourceReference(
  path: string,
  startLine: number,
  endLine: number,
): MarkdownCodeSourceReference | null {
  const normalizedPath = path.trim();
  if (
    !normalizedPath ||
    /[\r\n]/.test(normalizedPath) ||
    !Number.isSafeInteger(startLine) ||
    !Number.isSafeInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine
  ) {
    return null;
  }
  return { path: normalizedPath, startLine, endLine };
}

function serializeCodeFenceInfo(
  language: string,
  sourceReference: MarkdownCodeSourceReference,
): string {
  const tokens = language ? [language] : [];
  const lines = sourceReference.startLine === sourceReference.endLine
    ? String(sourceReference.startLine)
    : `${sourceReference.startLine}-${sourceReference.endLine}`;
  tokens.push(`file=${JSON.stringify(sourceReference.path)}`, `lines=${JSON.stringify(lines)}`);
  return tokens.join(" ");
}

function readFenceInfoAttribute(infoString: string, names: readonly string[]): string | null {
  const attributePattern = /(?:^|\s)([a-z][\w-]*)=("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+)/gi;
  let match = attributePattern.exec(infoString);
  while (match) {
    if (names.includes(match[1].toLowerCase())) return decodeFenceInfoAttribute(match[2]);
    match = attributePattern.exec(infoString);
  }
  return null;
}

function decodeFenceInfoAttribute(value: string): string {
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : "";
    } catch {
      return "";
    }
  }
  if (value.startsWith("'")) {
    return value.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  }
  return value;
}

function parseCodeLineRange(value: string | null): { startLine: number; endLine: number } | null {
  if (!value) return null;
  const match = /^L?(\d+)(?:\s*(?:-|:|\.\.)\s*L?(\d+))?$/i.exec(value.trim());
  if (!match) return null;
  const startLine = Number(match[1]);
  const endLine = Number(match[2] ?? match[1]);
  if (
    !Number.isSafeInteger(startLine) ||
    !Number.isSafeInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine
  ) {
    return null;
  }
  return { startLine, endLine };
}
