import { EditorState, StateField, Text, type ChangeSet } from "@codemirror/state";

type MarkdownHeadingEntry = Readonly<{
  rangeFrom: number;
  rangeTo: number;
  position: number;
  text: string;
}>;

export type MarkdownHeadingIndex = Readonly<{
  headings: readonly MarkdownHeadingEntry[];
  positions: ReadonlyMap<string, number>;
  get(key: string): number | undefined;
  has(key: string): boolean;
}>;

type DocumentRange = Readonly<{ from: number; to: number }>;

/**
 * Pane-local heading index used by both link projection and navigation.
 * Ordinary edits rescan only the changed lines plus their Setext neighbours;
 * rebuilding the small slug lookup is O(number of headings), not O(document).
 */
export const markdownHeadingIndexField = StateField.define<MarkdownHeadingIndex>({
  create(state) {
    return createMarkdownHeadingIndex(state.doc);
  },
  update(index, transaction) {
    if (!transaction.docChanged) return index;
    return updateMarkdownHeadingIndex(
      index,
      transaction.startState.doc,
      transaction.newDoc,
      transaction.changes,
    );
  },
});

export function getMarkdownHeadingPosition(state: EditorState, fragment: string): number | null {
  const key = normalizeMarkdownFragment(fragment);
  if (!key) return null;
  return state.field(markdownHeadingIndexField, false)?.get(key) ?? null;
}

export function createMarkdownHeadingIndex(doc: Text | string): MarkdownHeadingIndex {
  const source = typeof doc === "string" ? Text.of(doc.split("\n")) : doc;
  return assembleMarkdownHeadingIndex(scanMarkdownHeadings(source, 1, source.lines));
}

function updateMarkdownHeadingIndex(
  index: MarkdownHeadingIndex,
  oldDoc: Text,
  newDoc: Text,
  changes: ChangeSet,
): MarkdownHeadingIndex {
  const oldWindows: DocumentRange[] = [];
  const newWindows: DocumentRange[] = [];
  changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    oldWindows.push(expandHeadingScanWindow(oldDoc, fromA, toA));
    newWindows.push(expandHeadingScanWindow(newDoc, fromB, toB));
  });
  const mergedOldWindows = mergeDocumentRanges(oldWindows);
  const mergedNewWindows = mergeDocumentRanges(newWindows);

  const retained = index.headings
    .filter((heading) => !mergedOldWindows.some((window) => (
      heading.rangeFrom <= window.to && window.from <= heading.rangeTo
    )))
    .map((heading) => ({
      ...heading,
      rangeFrom: changes.mapPos(heading.rangeFrom, -1),
      rangeTo: changes.mapPos(heading.rangeTo, 1),
      position: changes.mapPos(heading.position, 1),
    }));
  const rescanned = mergedNewWindows.flatMap((window) => scanMarkdownHeadings(
    newDoc,
    newDoc.lineAt(window.from).number,
    newDoc.lineAt(window.to).number,
  ));

  return assembleMarkdownHeadingIndex(
    [...retained, ...rescanned].sort((left, right) => left.rangeFrom - right.rangeFrom),
  );
}

function assembleMarkdownHeadingIndex(
  headings: readonly MarkdownHeadingEntry[],
): MarkdownHeadingIndex {
  const positions = new Map<string, number>();
  const slugCounts = new Map<string, number>();

  for (const heading of headings) {
    const plainHeading = stripInlineMarkdown(heading.text);
    const baseSlug = slugifyMarkdownHeading(plainHeading);
    const duplicateIndex = slugCounts.get(baseSlug) ?? 0;
    slugCounts.set(baseSlug, duplicateIndex + 1);
    const slug = duplicateIndex === 0 ? baseSlug : `${baseSlug}-${duplicateIndex}`;

    for (const key of [normalizeMarkdownFragment(plainHeading), normalizeMarkdownFragment(slug)]) {
      if (key && !positions.has(key)) positions.set(key, heading.position);
    }
  }

  return Object.freeze({
    headings: Object.freeze([...headings]),
    positions,
    get: (key: string) => positions.get(key),
    has: (key: string) => positions.has(key),
  });
}

function scanMarkdownHeadings(
  doc: Text,
  fromLineNumber: number,
  toLineNumber: number,
): MarkdownHeadingEntry[] {
  const headings: MarkdownHeadingEntry[] = [];
  const lastLine = Math.min(doc.lines, toLineNumber);

  for (let lineNumber = Math.max(1, fromLineNumber); lineNumber <= lastLine; lineNumber += 1) {
    const line = doc.line(lineNumber);
    const heading = getAtxHeading(line.text) ?? getSetextHeading(doc, lineNumber);
    if (!heading) continue;
    headings.push({
      rangeFrom: line.from,
      rangeTo: heading.setextUnderlineTo ?? line.to,
      position: line.from + heading.from,
      text: heading.text,
    });
  }

  return headings;
}

function expandHeadingScanWindow(doc: Text, from: number, to: number): DocumentRange {
  const safeFrom = Math.max(0, Math.min(from, doc.length));
  const safeTo = Math.max(safeFrom, Math.min(to, doc.length));
  const firstLine = Math.max(1, doc.lineAt(safeFrom).number - 1);
  const lastLine = Math.min(doc.lines, doc.lineAt(safeTo).number + 1);
  return { from: doc.line(firstLine).from, to: doc.line(lastLine).to };
}

function mergeDocumentRanges(ranges: readonly DocumentRange[]): DocumentRange[] {
  const sorted = [...ranges].sort((left, right) => left.from - right.from);
  const merged: DocumentRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || range.from > previous.to) {
      merged.push({ ...range });
      continue;
    }
    merged[merged.length - 1] = { from: previous.from, to: Math.max(previous.to, range.to) };
  }
  return merged;
}

function getAtxHeading(text: string): { text: string; from: number; setextUnderlineTo?: number } | null {
  const match = /^\s{0,3}#{1,6}(?:[ \t]+|$)(.*)$/.exec(text);
  if (!match) return null;
  const value = (match[1] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim();
  return value ? { text: value, from: text.indexOf(value) } : null;
}

function getSetextHeading(
  doc: Text,
  lineNumber: number,
): { text: string; from: number; setextUnderlineTo?: number } | null {
  if (lineNumber >= doc.lines) return null;
  const line = doc.line(lineNumber);
  const underline = doc.line(lineNumber + 1);
  if (!/^\s{0,3}(?:=+|-+)\s*$/.test(underline.text) || !line.text.trim()) return null;
  const value = line.text.trim();
  return {
    text: value,
    from: line.text.indexOf(value),
    setextUnderlineTo: underline.to,
  };
}

function normalizeMarkdownFragment(value: string): string {
  const withoutHash = value.trim().replace(/^#/, "");
  if (!withoutHash) return "";
  try {
    return decodeURIComponent(withoutHash).trim().toLocaleLowerCase();
  } catch {
    return withoutHash.toLocaleLowerCase();
  }
}

function slugifyMarkdownHeading(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}\p{Mark}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim();
}
