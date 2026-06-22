import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { EditorSelection, EditorState, StateField, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
  dropCursor,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  placeholder,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

type LivePreviewDecorations = {
  decorations: DecorationSet;
  atomicRanges: DecorationSet;
};

type MarkdownDecorationBuilders = {
  decorations: Range<Decoration>[];
  atomicRanges: Range<Decoration>[];
};

type OccupiedRange = {
  from: number;
  to: number;
};

type MarkdownTableBlock = {
  from: number;
  to: number;
  nextLineNumber: number;
  rows: MarkdownTableRow[];
};

type MarkdownCodeBlock = {
  from: number;
  to: number;
  nextLineNumber: number;
  language: string;
  code: string;
};

type MarkdownTableCell = {
  text: string;
  from: number;
  to: number;
  editable: boolean;
};

type MarkdownTableRow = {
  cells: MarkdownTableCell[];
  header: boolean;
  lineTo: number;
};

export function markdownCodeMirrorBaseExtensions(readOnly: boolean): Extension[] {
  return [
    highlightSpecialChars(),
    history(),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(puppyMarkdownHighlightStyle),
    EditorView.lineWrapping,
    highlightActiveLine(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    placeholder(readOnly ? "" : "Start writing..."),
    puppyMarkdownEditorTheme,
  ];
}

export function markdownLivePreviewExtension(): Extension {
  return markdownLivePreviewDecorations;
}

const puppyMarkdownEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "inherit",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
  ".cm-line": {
    padding: "0",
  },
  "&.cm-focused": {
    outline: "none",
  },
});

const puppyMarkdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, class: "cm-md-syntax-heading" },
  { tag: [tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6], class: "cm-md-syntax-heading" },
  { tag: tags.strong, class: "cm-md-syntax-strong" },
  { tag: tags.emphasis, class: "cm-md-syntax-emphasis" },
  { tag: tags.strikethrough, class: "cm-md-syntax-strikethrough" },
  { tag: [tags.link, tags.url], class: "cm-md-syntax-link" },
  { tag: tags.monospace, class: "cm-md-syntax-monospace" },
  { tag: [tags.meta, tags.processingInstruction, tags.punctuation, tags.contentSeparator], class: "cm-md-syntax-markup" },
  { tag: tags.quote, class: "cm-md-syntax-quote" },
  { tag: tags.list, class: "cm-md-syntax-list" },
]);

const markdownLivePreviewDecorations = StateField.define<LivePreviewDecorations>({
  create(state) {
    return buildMarkdownDecorations(state);
  },
  update(decorations, transaction) {
    if (transaction.docChanged || transaction.selection || transaction.reconfigured) {
      return buildMarkdownDecorations(transaction.state);
    }
    return {
      decorations: decorations.decorations.map(transaction.changes),
      atomicRanges: decorations.atomicRanges.map(transaction.changes),
    };
  },
  provide(field) {
    return [
      EditorView.decorations.from(field, (value) => value.decorations),
      EditorView.atomicRanges.of((view) => view.state.field(field).atomicRanges),
    ];
  },
});

function buildMarkdownDecorations(state: EditorState): LivePreviewDecorations {
  const builders: MarkdownDecorationBuilders = {
    decorations: [],
    atomicRanges: [],
  };

  addMarkdownBlockAndLineDecorations(state, builders);

  return {
    decorations: builders.decorations.length > 0 ? Decoration.set(builders.decorations, true) : Decoration.none,
    atomicRanges: builders.atomicRanges.length > 0 ? Decoration.set(builders.atomicRanges, true) : Decoration.none,
  };
}

function addMarkdownBlockAndLineDecorations(state: EditorState, builders: MarkdownDecorationBuilders) {
  const lineCount = state.doc.lines;

  for (let lineNumber = 1; lineNumber <= lineCount;) {
    const line = state.doc.line(lineNumber);
    const codeBlock = getMarkdownCodeBlock(state, line.number);
    if (codeBlock) {
      addReplacementDecoration(
        builders,
        Decoration.replace({
          widget: new CodeBlockWidget(codeBlock.code, codeBlock.language, codeBlock.from, codeBlock.to),
          block: true,
        }),
        codeBlock.from,
        codeBlock.to,
      );
      lineNumber = codeBlock.nextLineNumber;
      continue;
    }

    const tableBlock = getMarkdownTableBlock(state, line.number);
    if (tableBlock) {
      addReplacementDecoration(
        builders,
        Decoration.replace({
          widget: new MarkdownTableWidget(tableBlock.rows),
          block: true,
        }),
        tableBlock.from,
        tableBlock.to,
      );
      lineNumber = tableBlock.nextLineNumber;
      continue;
    }

    decorateMarkdownLine(line.from, line.to, line.text, builders);
    lineNumber += 1;
  }
}

function decorateMarkdownLine(
  lineFrom: number,
  lineTo: number,
  text: string,
  builders: MarkdownDecorationBuilders,
) {
  const lineClasses = getMarkdownLineClasses(text);
  if (lineClasses) {
    builders.decorations.push(Decoration.line({ class: lineClasses }).range(lineFrom));
  }

  const hrMatch = /^(\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*)$/.exec(text);
  if (hrMatch && lineFrom < lineTo) {
    addReplacementDecoration(
      builders,
      Decoration.replace({
        widget: new HorizontalRuleWidget(),
        block: true,
      }),
      lineFrom,
      lineFrom + hrMatch[1].length,
    );
    return;
  }

  const headingMatch = /^(#{1,6})(\s|$)/.exec(text);
  if (headingMatch) {
    addHiddenDecoration(builders, lineFrom, lineFrom + headingMatch[0].length);
  }

  const blockquoteMarker = /^(\s*>\s?)/.exec(text);
  if (blockquoteMarker) {
    addHiddenDecoration(builders, lineFrom, lineFrom + blockquoteMarker[1].length);
  }

  const taskMatch = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\])\s?/.exec(text);
  if (taskMatch) {
    const checkboxFrom = lineFrom + taskMatch[1].length + taskMatch[2].length + 1;
    const checkboxTo = checkboxFrom + taskMatch[3].length;
    const prefixTo = lineFrom + taskMatch[0].length;
    addReplacementDecoration(
      builders,
      Decoration.replace({
        widget: new TaskCheckboxWidget(taskMatch[3].toLowerCase() === "[x]", checkboxFrom, getListDepth(taskMatch[1])),
        inclusive: false,
      }),
      lineFrom,
      prefixTo,
    );
    addInlineMarkdownDecorations(lineFrom, text, builders, [{ from: lineFrom, to: checkboxTo }]);
    return;
  }

  const listMatch = /^(\s*)([-*+]|\d+[.)])\s+/.exec(text);
  if (listMatch) {
    addReplacementDecoration(
      builders,
      Decoration.replace({
        widget: new ListMarkerWidget(getListMarkerText(listMatch[2]), getListDepth(listMatch[1])),
        inclusive: false,
      }),
      lineFrom,
      lineFrom + listMatch[0].length,
    );
  }

  addInlineMarkdownDecorations(lineFrom, text, builders);
}

function getMarkdownLineClasses(text: string): string {
  const classes: string[] = [];

  const headingMatch = /^(#{1,6})(?:\s|$)/.exec(text);
  if (headingMatch) {
    classes.push("cm-md-heading", `cm-md-heading-${headingMatch[1].length}`);
  }

  if (/^\s*>/.test(text)) classes.push("cm-md-blockquote");
  if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(text)) classes.push("cm-md-list-line");
  if (/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/.test(text)) classes.push("cm-md-task-line");
  if (/^\s*(?:[-*+]|\d+[.)])\s+\[[xX]\]/.test(text)) classes.push("cm-md-task-checked");
  if (/^\s*(`{3,}|~{3,})/.test(text)) classes.push("cm-md-code-fence");
  if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(text)) classes.push("cm-md-hr");
  if (isMarkdownTableLine(text)) classes.push("cm-md-table-line");

  return classes.join(" ");
}

function addInlineMarkdownDecorations(
  lineFrom: number,
  text: string,
  builders: MarkdownDecorationBuilders,
  initialOccupied: OccupiedRange[] = [],
) {
  const occupied = [...initialOccupied];

  addImageDecorations(lineFrom, text, builders, occupied);
  addLinkDecorations(lineFrom, text, builders, occupied);
  addDelimiterDecorations(lineFrom, text, /(\*\*|__)(\S(?:.*?\S)?)\1/g, 1, "cm-md-syntax-strong", builders, occupied);
  addDelimiterDecorations(lineFrom, text, /(~~)(\S(?:.*?\S)?)(~~)/g, 1, "cm-md-syntax-strikethrough", builders, occupied);
  addDelimiterDecorations(lineFrom, text, /(`)([^`\n]+)(`)/g, 1, "cm-md-syntax-monospace", builders, occupied);
  addItalicDecorations(lineFrom, text, builders, occupied);
}

function addImageDecorations(
  lineFrom: number,
  text: string,
  builders: MarkdownDecorationBuilders,
  occupied: OccupiedRange[],
) {
  const pattern = /!\[([^\]\n]*)\]\(([^)\n]+)\)/g;

  for (const match of text.matchAll(pattern)) {
    if (match.index == null) continue;
    const matchFrom = lineFrom + match.index;
    const matchTo = matchFrom + match[0].length;
    if (!reserveRange(occupied, matchFrom, matchTo)) continue;

    addReplacementDecoration(
      builders,
      Decoration.replace({
        widget: new ImagePreviewWidget(match[1], match[2]),
        inclusive: false,
      }),
      matchFrom,
      matchTo,
    );
  }
}

function addLinkDecorations(
  lineFrom: number,
  text: string,
  builders: MarkdownDecorationBuilders,
  occupied: OccupiedRange[],
) {
  const pattern = /(!?)\[([^\]\n]+)\]\(([^)\n]+)\)/g;

  for (const match of text.matchAll(pattern)) {
    if (match.index == null || match[1] === "!") continue;
    const label = match[2];
    if (!label) continue;

    const matchFrom = lineFrom + match.index;
    const labelFrom = matchFrom + 1;
    const labelTo = labelFrom + label.length;
    const matchTo = matchFrom + match[0].length;
    if (!reserveRange(occupied, matchFrom, matchTo)) continue;

    addHiddenDecoration(builders, matchFrom, labelFrom);
    builders.decorations.push(Decoration.mark({ class: "cm-md-syntax-link cm-md-link-label" }).range(labelFrom, labelTo));
    addHiddenDecoration(builders, labelTo, matchTo);
  }
}

function addDelimiterDecorations(
  lineFrom: number,
  text: string,
  pattern: RegExp,
  delimiterGroupIndex: number,
  contentClass: string,
  builders: MarkdownDecorationBuilders,
  occupied: OccupiedRange[],
) {
  for (const match of text.matchAll(pattern)) {
    if (match.index == null) continue;
    const delimiter = match[delimiterGroupIndex];
    const content = match[delimiterGroupIndex + 1];
    if (!delimiter || !content?.trim()) continue;

    const matchFrom = lineFrom + match.index;
    const openingTo = matchFrom + delimiter.length;
    const contentTo = openingTo + content.length;
    const closingTo = matchFrom + match[0].length;
    if (!reserveRange(occupied, matchFrom, closingTo)) continue;

    addHiddenDecoration(builders, matchFrom, openingTo);
    builders.decorations.push(Decoration.mark({ class: contentClass }).range(openingTo, contentTo));
    addHiddenDecoration(builders, contentTo, closingTo);
  }
}

function addItalicDecorations(
  lineFrom: number,
  text: string,
  builders: MarkdownDecorationBuilders,
  occupied: OccupiedRange[],
) {
  const pattern = /(^|[^\*])(\*)([^\s*](?:.*?[^\s*])?)(\*)(?!\*)/g;

  for (const match of text.matchAll(pattern)) {
    if (match.index == null) continue;
    const prefixLength = match[1].length;
    const content = match[3];
    if (!content?.trim()) continue;

    const openingFrom = lineFrom + match.index + prefixLength;
    const contentFrom = openingFrom + 1;
    const contentTo = contentFrom + content.length;
    const closingTo = contentTo + 1;
    if (!reserveRange(occupied, openingFrom, closingTo)) continue;

    addHiddenDecoration(builders, openingFrom, contentFrom);
    builders.decorations.push(Decoration.mark({ class: "cm-md-syntax-emphasis" }).range(contentFrom, contentTo));
    addHiddenDecoration(builders, contentTo, closingTo);
  }
}

function addHiddenDecoration(builders: MarkdownDecorationBuilders, from: number, to: number) {
  if (from >= to) return;
  addReplacementDecoration(builders, Decoration.replace({}), from, to);
}

function addReplacementDecoration(
  builders: MarkdownDecorationBuilders,
  decoration: Decoration,
  from: number,
  to: number,
) {
  if (from >= to) return;
  const range = decoration.range(from, to);
  builders.decorations.push(range);
  builders.atomicRanges.push(range);
}

function reserveRange(occupied: OccupiedRange[], from: number, to: number): boolean {
  if (from >= to) return false;
  if (occupied.some((range) => from < range.to && to > range.from)) return false;
  occupied.push({ from, to });
  return true;
}

function getListMarkerText(marker: string): string {
  if (/^\d+[.)]$/.test(marker)) return marker;
  return "\u2022";
}

function getListDepth(leadingWhitespace: string): number {
  return Math.floor(leadingWhitespace.replace(/\t/g, "    ").length / 2);
}

function getMarkdownCodeBlock(state: EditorState, lineNumber: number): MarkdownCodeBlock | null {
  const doc = state.doc;
  const openingLine = doc.line(lineNumber);
  const openingMatch = /^(\s*)(`{3,}|~{3,})([^\n`]*)$/.exec(openingLine.text);
  if (!openingMatch) return null;

  const fence = openingMatch[2];
  const fenceCharacter = fence[0];
  const minimumFenceLength = fence.length;
  const language = openingMatch[3].trim().split(/\s+/)[0] ?? "";
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
    language,
    code: codeLines.join("\n"),
  };
}

function getMarkdownTableBlock(state: EditorState, lineNumber: number): MarkdownTableBlock | null {
  const doc = state.doc;
  if (lineNumber >= doc.lines) return null;

  const headerLine = doc.line(lineNumber);
  const delimiterLine = doc.line(lineNumber + 1);
  if (!isTableHeaderLine(headerLine.text) || !isTableDelimiterLine(delimiterLine.text)) return null;

  const rows: MarkdownTableRow[] = [{
    cells: splitTableCellsWithPositions(headerLine),
    header: true,
    lineTo: headerLine.to,
  }];
  let lastLine = delimiterLine;
  let nextLineNumber = lineNumber + 2;

  while (nextLineNumber <= doc.lines) {
    const rowLine = doc.line(nextLineNumber);
    if (!isMarkdownTableLine(rowLine.text) || isTableDelimiterLine(rowLine.text)) break;
    rows.push({
      cells: splitTableCellsWithPositions(rowLine),
      header: false,
      lineTo: rowLine.to,
    });
    lastLine = rowLine;
    nextLineNumber += 1;
  }

  if (rows.length < 2) return null;

  return {
    from: headerLine.from,
    to: lastLine.to,
    nextLineNumber,
    rows: normalizeTableRows(rows),
  };
}

function isMarkdownTableLine(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.includes("|")) return false;
  if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed)) return true;
  return /^\|.+\|$/.test(trimmed);
}

function isTableHeaderLine(text: string): boolean {
  return splitTableCells(text).length >= 2;
}

function isTableDelimiterLine(text: string): boolean {
  const cells = splitTableCells(text);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitTableCells(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed.includes("|")) return [];
  const withoutEdgePipes = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return withoutEdgePipes.split("|").map((cell) => cell.trim());
}

function splitTableCellsWithPositions(line: { from: number; to: number; text: string }): MarkdownTableCell[] {
  const text = line.text;
  const pipeIndexes = Array.from(text.matchAll(/\|/g), (match) => match.index).filter((index): index is number => index != null);
  if (pipeIndexes.length === 0) return [];

  const firstContentIndex = text.search(/\S/);
  const lastContentIndex = findLastNonWhitespaceIndex(text);
  const hasLeadingPipe = firstContentIndex >= 0 && text[firstContentIndex] === "|";
  const hasTrailingPipe = lastContentIndex >= 0 && text[lastContentIndex] === "|";
  const boundaries: number[] = [];

  if (hasLeadingPipe) {
    boundaries.push(pipeIndexes[0]);
    boundaries.push(...pipeIndexes.slice(1));
  } else {
    boundaries.push(-1, ...pipeIndexes);
  }

  if (!hasTrailingPipe) {
    boundaries.push(text.length);
  }

  const cells: MarkdownTableCell[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const rawFrom = Math.max(0, boundaries[index] + 1);
    const rawTo = Math.min(text.length, boundaries[index + 1]);
    const raw = text.slice(rawFrom, rawTo);
    const leadingWhitespaceLength = raw.match(/^\s*/)?.[0].length ?? 0;
    const trailingWhitespaceLength = raw.match(/\s*$/)?.[0].length ?? 0;
    const cellFrom = line.from + rawFrom + leadingWhitespaceLength;
    const cellTo = line.from + rawTo - trailingWhitespaceLength;
    cells.push({
      text: raw.trim(),
      from: cellFrom,
      to: Math.max(cellFrom, cellTo),
      editable: true,
    });
  }

  return cells;
}

function findLastNonWhitespaceIndex(text: string): number {
  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (!/\s/.test(text[index])) return index;
  }
  return -1;
}

function normalizeTableRows(rows: MarkdownTableRow[]): MarkdownTableRow[] {
  const width = Math.max(...rows.map((row) => row.cells.length));
  return rows.map((row) => ({
    ...row,
    cells: Array.from({ length: width }, (_, index) => row.cells[index] ?? {
      text: "",
      from: row.lineTo,
      to: row.lineTo,
      editable: false,
    }),
  }));
}

class ListMarkerWidget extends WidgetType {
  constructor(
    private readonly marker: string,
    private readonly depth: number,
  ) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return widget instanceof ListMarkerWidget && widget.marker === this.marker && widget.depth === this.depth;
  }

  toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.className = "cm-md-list-marker";
    marker.style.setProperty("--md-list-depth", String(this.depth));
    marker.textContent = this.marker;
    return marker;
  }
}

class TaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly from: number,
    private readonly depth: number,
  ) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return (
      widget instanceof TaskCheckboxWidget &&
      widget.checked === this.checked &&
      widget.from === this.from &&
      widget.depth === this.depth
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const checkbox = document.createElement("button");
    checkbox.type = "button";
    checkbox.className = this.checked ? "cm-md-task-checkbox is-checked" : "cm-md-task-checkbox";
    checkbox.style.setProperty("--md-list-depth", String(this.depth));
    checkbox.setAttribute("aria-label", this.checked ? "Mark task incomplete" : "Mark task complete");

    checkbox.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    checkbox.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (view.state.readOnly) return;

      const nextValue = this.checked ? "[ ]" : "[x]";
      view.dispatch({
        changes: { from: this.from, to: this.from + 3, insert: nextValue },
        selection: EditorSelection.cursor(this.from + nextValue.length),
      });
      view.focus();
    });

    return checkbox;
  }

  ignoreEvent() {
    return true;
  }
}

class HorizontalRuleWidget extends WidgetType {
  eq(widget: WidgetType): boolean {
    return widget instanceof HorizontalRuleWidget;
  }

  toDOM(): HTMLElement {
    const rule = document.createElement("div");
    rule.className = "cm-md-hr-widget";
    return rule;
  }
}

class CodeBlockWidget extends WidgetType {
  constructor(
    private readonly code: string,
    private readonly language: string,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return (
      widget instanceof CodeBlockWidget &&
      widget.code === this.code &&
      widget.language === this.language &&
      widget.from === this.from &&
      widget.to === this.to
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-code-widget";
    const panel = document.createElement("div");
    panel.className = "cm-md-code-panel";
    const readOnly = view.state.readOnly;
    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      this.commitCodeBlockChange(view, languageInput.value, codeEditor.value);
    };

    const languageInput = document.createElement("input");
    languageInput.className = "cm-md-code-language";
    if (!this.language) languageInput.classList.add("is-empty");
    languageInput.value = this.language;
    languageInput.placeholder = "language";
    languageInput.readOnly = readOnly;
    languageInput.spellcheck = false;
    languageInput.addEventListener("mousedown", stopCodeMirrorEvent);
    languageInput.addEventListener("click", stopCodeMirrorEvent);
    languageInput.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        languageInput.blur();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        languageInput.value = this.language;
        languageInput.blur();
      }
    });
    languageInput.addEventListener("blur", () => {
      if (readOnly) return;
      commit();
    });
    panel.appendChild(languageInput);

    const codeEditor = document.createElement("textarea");
    codeEditor.className = "cm-md-code-textarea";
    codeEditor.value = this.code;
    codeEditor.readOnly = readOnly;
    codeEditor.spellcheck = false;
    codeEditor.rows = Math.max(1, this.code.split("\n").length);
    codeEditor.addEventListener("mousedown", stopCodeMirrorEvent);
    codeEditor.addEventListener("click", stopCodeMirrorEvent);
    codeEditor.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        codeEditor.value = this.code;
        codeEditor.blur();
      }
    });
    codeEditor.addEventListener("blur", () => {
      if (readOnly) return;
      commit();
    });
    panel.appendChild(codeEditor);
    wrapper.appendChild(panel);

    return wrapper;
  }

  private commitCodeBlockChange(view: EditorView, nextLanguage: string, nextCode: string) {
    const language = sanitizeCodeLanguage(nextLanguage);
    const code = normalizeLineEndings(nextCode);
    if (language === this.language && code === this.code) return;

    view.dispatch({
      changes: {
        from: this.from,
        to: this.to,
        insert: serializeMarkdownCodeBlock(language, code),
      },
    });
  }

  ignoreEvent() {
    return true;
  }
}

class ImagePreviewWidget extends WidgetType {
  constructor(
    private readonly alt: string,
    private readonly source: string,
  ) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return widget instanceof ImagePreviewWidget && widget.alt === this.alt && widget.source === this.source;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-md-image-widget";
    wrapper.title = this.source;

    if (/^(https?:|data:|blob:)/i.test(this.source)) {
      const image = document.createElement("img");
      image.src = this.source;
      image.alt = this.alt;
      image.loading = "lazy";
      image.addEventListener("load", () => view.requestMeasure());
      image.addEventListener("error", () => view.requestMeasure());
      wrapper.appendChild(image);
      return wrapper;
    }

    const label = document.createElement("span");
    label.className = "cm-md-image-placeholder";
    label.textContent = this.alt || this.source;
    wrapper.appendChild(label);
    return wrapper;
  }
}

class MarkdownTableWidget extends WidgetType {
  constructor(
    private readonly rows: MarkdownTableRow[],
  ) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return widget instanceof MarkdownTableWidget && JSON.stringify(widget.rows) === JSON.stringify(this.rows);
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-table-widget-wrap";

    const table = document.createElement("table");
    table.className = "cm-md-table-widget";

    const header = this.rows.find((row) => row.header);
    if (header) {
      const thead = document.createElement("thead");
      const tr = document.createElement("tr");
      for (const cell of header.cells) {
        const th = document.createElement("th");
        th.appendChild(createTableCellEditor(view, cell));
        tr.appendChild(th);
      }
      thead.appendChild(tr);
      table.appendChild(thead);
    }

    const bodyRows = this.rows.filter((row) => !row.header);
    if (bodyRows.length > 0) {
      const tbody = document.createElement("tbody");
      for (const row of bodyRows) {
        const tr = document.createElement("tr");
        for (const cell of row.cells) {
          const td = document.createElement("td");
          td.appendChild(createTableCellEditor(view, cell));
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
    }

    wrapper.appendChild(table);

    return wrapper;
  }

  ignoreEvent() {
    return true;
  }
}

function createTableCellEditor(view: EditorView, cell: MarkdownTableCell): HTMLElement {
  const content = document.createElement("span");
  content.className = "cm-md-table-cell-content";
  content.textContent = cell.text;
  content.spellcheck = false;

  if (!view.state.readOnly && cell.editable) {
    content.contentEditable = "true";
    content.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        content.blur();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        content.textContent = cell.text;
        content.blur();
      }
    });
    content.addEventListener("blur", () => {
      const nextValue = sanitizeMarkdownTableCell(content.textContent ?? "");
      if (nextValue === cell.text) return;
      view.dispatch({
        changes: {
          from: cell.from,
          to: cell.to,
          insert: nextValue,
        },
      });
    });
  }

  content.addEventListener("mousedown", stopCodeMirrorEvent);
  content.addEventListener("click", stopCodeMirrorEvent);
  content.addEventListener("input", stopCodeMirrorEvent);

  return content;
}

function stopCodeMirrorEvent(event: Event) {
  event.stopPropagation();
}

function sanitizeMarkdownTableCell(value: string): string {
  return normalizeLineEndings(value).replace(/\n+/g, " ").replace(/\|/g, "\\|").trim();
}

function sanitizeCodeLanguage(value: string): string {
  return value.trim().replace(/\s+/g, "-").replace(/[`~]/g, "");
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function serializeMarkdownCodeBlock(language: string, code: string): string {
  const longestFence = Math.max(2, ...Array.from(code.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestFence + 1));
  const info = language ? `${fence}${language}` : fence;
  return `${info}\n${code}\n${fence}`;
}
