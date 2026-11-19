import {
  TYPE,
  parse,
  type MessageFormatElement,
  type PluralOrSelectOption,
} from "@formatjs/icu-messageformat-parser";
import { printAST } from "@formatjs/icu-messageformat-parser/printer.js";
import type { LocaleCatalog } from "../core";

export type PseudoLocaleMode = "expanded-ltr" | "mirrored-rtl";

const PROTECTED_TERMS = [
  "PuppyOne",
  "GitHub",
  "Claude",
  "Codex",
  "Git",
  "MCP",
  "CLI",
  "PDF",
] as const;

const PROTECTED_TERM_PATTERN = new RegExp(
  `(${PROTECTED_TERMS.map(escapeRegExp).join("|")})`,
  "g",
);

const EXPANDED_GLYPHS: Readonly<Record<string, string>> = Object.freeze({
  a: "áà",
  b: "ƀ",
  c: "ç",
  d: "ď",
  e: "éë",
  f: "ƒ",
  g: "ğ",
  h: "ħ",
  i: "íï",
  j: "ĵ",
  k: "ķ",
  l: "ľ",
  m: "ɱ",
  n: "ñ",
  o: "óö",
  p: "þ",
  q: "ʠ",
  r: "ř",
  s: "š",
  t: "ţ",
  u: "úü",
  v: "ṽ",
  w: "ŵ",
  x: "ẋ",
  y: "ý",
  z: "ž",
});

const RTL_GLYPHS: Readonly<Record<string, string>> = Object.freeze({
  a: "ا",
  b: "ب",
  c: "ج",
  d: "د",
  e: "ه",
  f: "ف",
  g: "غ",
  h: "ح",
  i: "ي",
  j: "ژ",
  k: "ك",
  l: "ل",
  m: "م",
  n: "ن",
  o: "و",
  p: "پ",
  q: "ق",
  r: "ر",
  s: "س",
  t: "ت",
  u: "ؤ",
  v: "ڤ",
  w: "و",
  x: "خ",
  y: "ى",
  z: "ز",
});

export function createPseudoCatalog(
  source: LocaleCatalog,
  mode: PseudoLocaleMode,
): LocaleCatalog {
  return Object.freeze(Object.fromEntries(
    Object.entries(source).map(([messageId, message]) => [
      messageId,
      createPseudoMessage(message, mode),
    ]),
  ));
}

export function createPseudoMessage(message: string, mode: PseudoLocaleMode): string {
  const transform = mode === "expanded-ltr" ? expandLiteral : mirrorLiteral;
  const transformed = transformElements(parse(message), transform);
  const prefix = mode === "mirrored-rtl" ? "\u2067⟦" : "⟦";
  const suffix = mode === "mirrored-rtl" ? "⟧\u2069" : "⟧";
  return printAST([
    { type: TYPE.literal, value: prefix },
    ...transformed,
    { type: TYPE.literal, value: suffix },
  ]);
}

function transformElements(
  elements: readonly MessageFormatElement[],
  transform: (value: string) => string,
): MessageFormatElement[] {
  return elements.map((element): MessageFormatElement => {
    if (element.type === TYPE.literal) {
      return { ...element, value: transformProtectedSegments(element.value, transform) };
    }
    if (element.type === TYPE.select || element.type === TYPE.plural) {
      return {
        ...element,
        options: Object.fromEntries(
          Object.entries(element.options).map(([key, option]) => [
            key,
            transformOption(option, transform),
          ]),
        ),
      };
    }
    if (element.type === TYPE.tag) {
      return { ...element, children: transformElements(element.children, transform) };
    }
    return { ...element };
  });
}

function transformOption(
  option: PluralOrSelectOption,
  transform: (value: string) => string,
): PluralOrSelectOption {
  return { ...option, value: transformElements(option.value, transform) };
}

function transformProtectedSegments(
  value: string,
  transform: (value: string) => string,
): string {
  return value
    .split(PROTECTED_TERM_PATTERN)
    .map((segment) => (
      (PROTECTED_TERMS as readonly string[]).includes(segment) ? segment : transform(segment)
    ))
    .join("");
}

function expandLiteral(value: string): string {
  return transformLatinLetters(value, EXPANDED_GLYPHS);
}

function mirrorLiteral(value: string): string {
  return transformLatinLetters(value, RTL_GLYPHS);
}

function transformLatinLetters(
  value: string,
  glyphs: Readonly<Record<string, string>>,
): string {
  return [...value].map((character) => {
    const replacement = glyphs[character.toLowerCase()];
    if (!replacement) return character;
    return character === character.toUpperCase() ? replacement.toUpperCase() : replacement;
  }).join("");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
