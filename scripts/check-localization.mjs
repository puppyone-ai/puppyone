import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IntlMessageFormat } from "intl-messageformat";
import ts from "typescript";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localesRoot = path.join(repositoryRoot, "locales");
const rendererRoot = path.join(localesRoot, "renderer");
const nativeRoot = path.join(localesRoot, "native");
const manifest = await readJson(path.join(localesRoot, "manifest.json"));
const userFacingJsxAttributes = new Set(["alt", "aria-label", "placeholder", "title"]);
const allowedUserInterfaceLiterals = new Set([
  // Product/provider brands and protocol vocabulary are proper nouns, not translatable copy.
  "Claude",
  "Git",
  "GitHub",
  "PuppyOne Cloud",
  "Puppyone Cloud",
  "CLI",
  "HEAD",
  "PDF",
  // Input examples and file-extension tokens intentionally preserve their syntax.
  "https://…",
  // Decorative sharing example: keep the product URL identical in every locale.
  "puppyone.ai/…",
  "md",
]);

const expectedLocales = ["en", "es", "pt-BR", "fr", "de", "ja", "ko", "zh-Hans"];
const actualLocales = manifest.locales?.map((entry) => entry.locale) ?? [];
assert(manifest.version === 1, "Locale manifest version must be 1.");
assert(manifest.defaultLocale === "en", "English must remain the final fallback locale.");
assert(
  JSON.stringify(actualLocales) === JSON.stringify(expectedLocales),
  `Locale manifest order must be: ${expectedLocales.join(", ")}.`,
);
assert(
  manifest.locales.every((entry) => entry.productionReady === true),
  "Only production-ready locales may ship in the locale picker.",
);

const namespaceFiles = (await fs.readdir(path.join(rendererRoot, "en")))
  .filter((name) => name.endsWith(".json"))
  .sort();
assert(namespaceFiles.length > 0, "English renderer catalog has no namespaces.");

const rendererMessageIds = new Set();
const englishRendererByNamespace = new Map();
for (const filename of namespaceFiles) {
  const namespace = filename.slice(0, -".json".length);
  const catalog = await readCatalog(path.join(rendererRoot, "en", filename), `en/${filename}`);
  englishRendererByNamespace.set(namespace, catalog);
  for (const key of Object.keys(catalog)) {
    const messageId = `${namespace}.${key}`;
    assert(!rendererMessageIds.has(messageId), `Duplicate renderer message ID: ${messageId}.`);
    rendererMessageIds.add(messageId);
  }
}

for (const locale of expectedLocales) {
  const localeFiles = (await fs.readdir(path.join(rendererRoot, locale)))
    .filter((name) => name.endsWith(".json"))
    .sort();
  assertSameList(localeFiles, namespaceFiles, `${locale} renderer namespace files`);

  for (const filename of namespaceFiles) {
    const namespace = filename.slice(0, -".json".length);
    const englishCatalog = englishRendererByNamespace.get(namespace);
    const localizedCatalog = await readCatalog(
      path.join(rendererRoot, locale, filename),
      `${locale}/${filename}`,
    );
    assertSameList(
      Object.keys(localizedCatalog).sort(),
      Object.keys(englishCatalog).sort(),
      `${locale}/${filename} message keys`,
    );
    for (const key of Object.keys(englishCatalog)) {
      validateMessagePair({
        messageId: `${namespace}.${key}`,
        locale,
        localized: localizedCatalog[key],
        english: englishCatalog[key],
      });
    }
  }
}

const nativeMessageIds = new Set();
const englishNative = await readCatalog(path.join(nativeRoot, "en.json"), "native/en.json");
for (const messageId of Object.keys(englishNative)) {
  assert(messageId.startsWith("native."), `Native message ID must start with native.: ${messageId}.`);
  nativeMessageIds.add(messageId);
}
for (const locale of expectedLocales) {
  const catalog = await readCatalog(path.join(nativeRoot, `${locale}.json`), `native/${locale}.json`);
  assertSameList(
    Object.keys(catalog).sort(),
    Object.keys(englishNative).sort(),
    `${locale} native message keys`,
  );
  for (const messageId of Object.keys(englishNative)) {
    validateMessagePair({
      messageId,
      locale,
      localized: catalog[messageId],
      english: englishNative[messageId],
    });
  }
}

await validateMessageReferences(
  [path.join(repositoryRoot, "src"), path.join(repositoryRoot, "packages", "shared-ui", "src")],
  rendererMessageIds,
);
await validateMessageReferences(
  [path.join(repositoryRoot, "electron")],
  nativeMessageIds,
);
await validateNoHardcodedUserInterfaceText([
  path.join(repositoryRoot, "src"),
  path.join(repositoryRoot, "packages", "shared-ui", "src"),
]);

console.log(
  `Localization architecture OK: ${expectedLocales.length} locales, `
  + `${rendererMessageIds.size} renderer messages, ${nativeMessageIds.size} native messages.`,
);

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read JSON ${path.relative(repositoryRoot, filePath)}: ${error.message}`);
  }
}

async function readCatalog(filePath, label) {
  const value = await readJson(filePath);
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  for (const [key, message] of Object.entries(value)) {
    assert(key.length > 0, `${label} contains an empty message key.`);
    assert(typeof message === "string" && message.length > 0, `${label}:${key} must be non-empty text.`);
  }
  return value;
}

function validateMessagePair({ messageId, locale, localized, english }) {
  const localizedAst = parseMessage(localized, locale, messageId);
  const englishAst = parseMessage(english, "en", messageId);
  const localizedArguments = collectArguments(localizedAst);
  const englishArguments = collectArguments(englishAst);
  assertSameList(
    [...localizedArguments].sort(),
    [...englishArguments].sort(),
    `${locale}:${messageId} ICU placeholders`,
  );
  assert(!containsRichTag(localizedAst), `${locale}:${messageId} contains a forbidden rich-text tag.`);
}

function parseMessage(message, locale, messageId) {
  try {
    return new IntlMessageFormat(message, locale, undefined, { ignoreTag: false }).getAst();
  } catch (error) {
    throw new Error(`${locale}:${messageId} is invalid ICU MessageFormat: ${error.message}`);
  }
}

function collectArguments(nodes, result = new Set()) {
  for (const node of nodes) {
    if (node && typeof node === "object" && [1, 2, 3, 4, 5, 6].includes(node.type)) {
      result.add(node.value);
    }
    if (node?.options) {
      for (const option of Object.values(node.options)) collectArguments(option.value ?? [], result);
    }
    if (Array.isArray(node?.children)) collectArguments(node.children, result);
  }
  return result;
}

function containsRichTag(nodes) {
  for (const node of nodes) {
    if (node?.type === 8) return true;
    if (node?.options) {
      for (const option of Object.values(node.options)) {
        if (containsRichTag(option.value ?? [])) return true;
      }
    }
    if (Array.isArray(node?.children) && containsRichTag(node.children)) return true;
  }
  return false;
}

async function validateMessageReferences(roots, knownMessageIds) {
  for (const root of roots) {
    for (const filePath of await listSourceFiles(root)) {
      const source = await fs.readFile(filePath, "utf8");
      const sourceFile = ts.createSourceFile(
        filePath,
        source,
        ts.ScriptTarget.Latest,
        true,
        sourceFileKind(filePath),
      );
      visitLocalizationCalls(sourceFile, (argument) => {
        for (const messageId of collectLiteralMessageIds(argument)) {
          if (!isLocalizationMessageId(messageId)) continue;
          assert(
            knownMessageIds.has(messageId),
            `${path.relative(repositoryRoot, filePath)} references unknown message ID ${messageId}.`,
          );
        }
        for (const pattern of collectTemplateMessagePatterns(argument)) {
          const matches = [...knownMessageIds].filter((messageId) => pattern.regex.test(messageId));
          assert(
            matches.length > 0,
            `${path.relative(repositoryRoot, filePath)} references a message template with no catalog matches: ${pattern.display}.`,
          );
        }
      });
    }
  }
}

async function validateNoHardcodedUserInterfaceText(roots) {
  for (const root of roots) {
    for (const filePath of await listSourceFiles(root)) {
      if (!/\.[cm]?[jt]sx$/.test(filePath)) continue;
      const source = await fs.readFile(filePath, "utf8");
      const sourceFile = ts.createSourceFile(
        filePath,
        source,
        ts.ScriptTarget.Latest,
        true,
        sourceFileKind(filePath),
      );
      const inspect = (node) => {
        if (ts.isJsxText(node)) {
          validateUserInterfaceLiteral(node.text, node, sourceFile, filePath, "JSX text");
        } else if (
          ts.isJsxAttribute(node)
          && userFacingJsxAttributes.has(node.name.text)
          && node.initializer
          && ts.isStringLiteral(node.initializer)
        ) {
          validateUserInterfaceLiteral(
            node.initializer.text,
            node,
            sourceFile,
            filePath,
            `${node.name.text} attribute`,
          );
        }
        ts.forEachChild(node, inspect);
      };
      inspect(sourceFile);
    }
  }
}

function validateUserInterfaceLiteral(value, node, sourceFile, filePath, kind) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || !/\p{L}{2,}/u.test(normalized)) return;
  if (allowedUserInterfaceLiterals.has(normalized)) return;
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  assert(
    false,
    `${path.relative(repositoryRoot, filePath)}:${line + 1} contains hardcoded ${kind} `
      + `${JSON.stringify(normalized)}. Use a locale message or document an intentional technical token.`,
  );
}

function sourceFileKind(filePath) {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".ts")) return ts.ScriptKind.TS;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function visitLocalizationCalls(sourceFile, onArgument) {
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.arguments.length > 0 && isTranslatorExpression(node.expression)) {
      onArgument(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function isTranslatorExpression(expression) {
  return (ts.isIdentifier(expression) && expression.text === "t")
    || (ts.isPropertyAccessExpression(expression) && expression.name.text === "t");
}

function collectLiteralMessageIds(node, result = new Set()) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    result.add(node.text);
    return result;
  }
  if (!ts.isTemplateExpression(node)) ts.forEachChild(node, (child) => collectLiteralMessageIds(child, result));
  return result;
}

function collectTemplateMessagePatterns(node, result = []) {
  if (ts.isTemplateExpression(node)) {
    const literalParts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
    const display = literalParts.map((part, index) => index === literalParts.length - 1 ? part : `${part}\${…}`).join("");
    const regex = new RegExp(`^${literalParts.map(escapeRegex).join(".+")}$`);
    if (isLocalizationMessageId(literalParts[0])) result.push({ display, regex });
    return result;
  }
  ts.forEachChild(node, (child) => collectTemplateMessagePatterns(child, result));
  return result;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isLocalizationMessageId(messageId) {
  const prefix = messageId.split(".")[0];
  return messageId.startsWith("native.") || namespaceFiles.includes(`${prefix}.json`);
}

async function listSourceFiles(root) {
  const result = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await listSourceFiles(filePath));
    else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) result.push(filePath);
  }
  return result;
}

function assertSameList(actual, expected, label) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} differ. Expected [${expected.join(", ")}], received [${actual.join(", ")}].`,
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
