const FIRST_STRONG_ISOLATE = "\u2068";
const POP_DIRECTIONAL_ISOLATE = "\u2069";

export function bidiIsolate(value: unknown): string {
  const text = String(value ?? "");
  if (text.startsWith(FIRST_STRONG_ISOLATE) && text.endsWith(POP_DIRECTIONAL_ISOLATE)) {
    return text;
  }
  return `${FIRST_STRONG_ISOLATE}${text}${POP_DIRECTIONAL_ISOLATE}`;
}
