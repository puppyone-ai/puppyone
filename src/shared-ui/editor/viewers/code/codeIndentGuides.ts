import { getIndentUnit } from "@codemirror/language";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

export const codeIndentGuides = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildIndentGuides(view);
  }

  update(update: ViewUpdate) {
    const indentationChanged = getIndentUnit(update.startState) !== getIndentUnit(update.state)
      || update.startState.tabSize !== update.state.tabSize;
    if (update.docChanged || update.viewportChanged || indentationChanged) {
      this.decorations = buildIndentGuides(update.view);
    }
  }
}, {
  decorations: (plugin) => plugin.decorations,
});

export function getIndentGuideCharacterOffsets(
  text: string,
  indentUnit: number,
  tabSize: number,
): number[] {
  if (indentUnit <= 0 || tabSize <= 0) return [];

  const whitespace: Array<{ offset: number; fromColumn: number; toColumn: number }> = [];
  let column = 0;
  for (let offset = 0; offset < text.length; offset += 1) {
    const character = text[offset];
    if (character !== " " && character !== "\t") break;
    const nextColumn = character === "\t"
      ? column + tabSize - (column % tabSize)
      : column + 1;
    whitespace.push({ offset, fromColumn: column, toColumn: nextColumn });
    column = nextColumn;
  }

  const completeIndentLevels = Math.floor(column / indentUnit);
  if (completeIndentLevels === 0) return [];

  const offsets: number[] = [];
  for (let level = 0; level < completeIndentLevels; level += 1) {
    const guideColumn = level * indentUnit;
    const character = whitespace.find(({ fromColumn, toColumn }) => (
      fromColumn <= guideColumn && guideColumn < toColumn
    ));
    if (character && offsets[offsets.length - 1] !== character.offset) {
      offsets.push(character.offset);
    }
  }
  return offsets;
}

function buildIndentGuides(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const indentUnit = getIndentUnit(view.state);
  const tabSize = view.state.tabSize;
  const { from, to } = view.viewport;
  let line = view.state.doc.lineAt(from);

  while (line.from <= to) {
    for (const offset of getIndentGuideCharacterOffsets(line.text, indentUnit, tabSize)) {
      builder.add(
        line.from + offset,
        line.from + offset + 1,
        Decoration.mark({ class: "cm-codeIndentGuide" }),
      );
    }
    if (line.to >= to || line.number >= view.state.doc.lines) break;
    line = view.state.doc.line(line.number + 1);
  }

  return builder.finish();
}
