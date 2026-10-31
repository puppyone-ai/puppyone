import { StreamLanguage, indentUnit } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";

export type CodeLanguageKey =
  | "css"
  | "html"
  | "javascript"
  | "json"
  | "jsx"
  | "less"
  | "plaintext"
  | "python"
  | "scss"
  | "shell"
  | "sql"
  | "toml"
  | "tsx"
  | "typescript"
  | "xml"
  | "yaml";

const languageExtensionCache = new Map<CodeLanguageKey, Promise<Extension>>();

export function resolveCodeLanguageKey(
  language: string | null | undefined,
  nodeName: string,
): CodeLanguageKey {
  const lowerName = nodeName.toLowerCase();
  const normalized = normalizeLanguage(language);

  if ((normalized === "typescript" || normalized === null) && lowerName.endsWith(".tsx")) return "tsx";
  if ((normalized === "javascript" || normalized === null) && lowerName.endsWith(".jsx")) return "jsx";
  if (normalized) return normalized;

  if (/\.(?:ts|cts|mts)$/i.test(lowerName)) return "typescript";
  if (/\.(?:js|cjs|es6|mjs|pac)$/i.test(lowerName)) return "javascript";
  if (/\.(?:py|pyi|pyw|pyx)$/i.test(lowerName)) return "python";
  if (/\.(?:ya?ml)$/i.test(lowerName)) return "yaml";
  if (/\.(?:sh|bash|zsh)$/i.test(lowerName)) return "shell";
  if (lowerName.endsWith(".toml")) return "toml";
  if (lowerName.endsWith(".sql")) return "sql";
  if (lowerName.endsWith(".css")) return "css";
  if (/\.(?:scss|sass)$/i.test(lowerName)) return "scss";
  if (lowerName.endsWith(".less")) return "less";
  if (/\.(?:html?|xhtml)$/i.test(lowerName)) return "html";
  if (/\.(?:xml|svg)$/i.test(lowerName)) return "xml";
  if (/\.(?:json|jsonl)$/i.test(lowerName)) return "json";
  return "plaintext";
}

export function loadCodeLanguageExtension(languageKey: CodeLanguageKey): Promise<Extension> {
  const cached = languageExtensionCache.get(languageKey);
  if (cached) return cached;

  const extension = loadLanguage(languageKey).then((languageSupport) => {
    const indentationWidth = languageKey === "python" ? 4 : 2;
    return [
      EditorState.tabSize.of(indentationWidth),
      indentUnit.of(" ".repeat(indentationWidth)),
      languageSupport,
    ];
  });
  languageExtensionCache.set(languageKey, extension);
  void extension.catch(() => {
    if (languageExtensionCache.get(languageKey) === extension) {
      languageExtensionCache.delete(languageKey);
    }
  });
  return extension;
}

async function loadLanguage(languageKey: CodeLanguageKey): Promise<Extension> {
  switch (languageKey) {
    case "javascript":
    case "jsx": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({ jsx: languageKey === "jsx" });
    }
    case "typescript":
    case "tsx": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({ typescript: true, jsx: languageKey === "tsx" });
    }
    case "html":
    case "xml": {
      const { html } = await import("@codemirror/lang-html");
      return html();
    }
    case "css":
    case "scss":
    case "less": {
      const { css } = await import("@codemirror/lang-css");
      return css();
    }
    case "json": {
      const { json } = await import("@codemirror/lang-json");
      return json();
    }
    case "python": {
      const { python } = await import("@codemirror/lang-python");
      return python();
    }
    case "yaml": {
      const { yaml } = await import("@codemirror/lang-yaml");
      return yaml();
    }
    case "sql": {
      const { sql } = await import("@codemirror/lang-sql");
      return sql();
    }
    case "shell": {
      const { shell } = await import("@codemirror/legacy-modes/mode/shell");
      return StreamLanguage.define(shell);
    }
    case "toml": {
      const { toml } = await import("@codemirror/legacy-modes/mode/toml");
      return StreamLanguage.define(toml);
    }
    case "plaintext":
      return [];
  }
}

function normalizeLanguage(language: string | null | undefined): CodeLanguageKey | null {
  const value = language?.trim().toLowerCase();
  if (!value) return null;
  if (value === "js") return "javascript";
  if (value === "ts") return "typescript";
  if (value === "py") return "python";
  if (value === "bash" || value === "zsh" || value === "sh") return "shell";
  if (value === "yml") return "yaml";
  if (value === "text" || value === "txt") return "plaintext";
  return isCodeLanguageKey(value) ? value : "plaintext";
}

function isCodeLanguageKey(value: string): value is CodeLanguageKey {
  return [
    "css",
    "html",
    "javascript",
    "json",
    "jsx",
    "less",
    "plaintext",
    "python",
    "scss",
    "shell",
    "sql",
    "toml",
    "tsx",
    "typescript",
    "xml",
    "yaml",
  ].includes(value);
}
