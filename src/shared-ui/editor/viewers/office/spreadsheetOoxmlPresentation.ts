import type JSZip from "jszip";
import { SaxesParser, type SaxesTagPlain } from "saxes";
import {
  MAX_SPREADSHEET_MATERIALIZED_CELLS,
  MAX_SPREADSHEET_STYLES,
  type SpreadsheetCellBorder,
  type SpreadsheetCellStyle,
} from "./spreadsheetPreview";

const MAX_RELATIONSHIP_XML_BYTES = 1 * 1024 * 1024;
const MAX_STYLE_XML_BYTES = 8 * 1024 * 1024;
const MAX_THEME_XML_BYTES = 4 * 1024 * 1024;
const MAX_SHEET_XML_BYTES = 32 * 1024 * 1024;
const MAX_XML_START_TAGS = 1_000_000;
const MAX_XML_DEPTH = 256;

type WorkbookSheetRelationship = {
  id: string;
  name: string;
};

type RawColor = {
  indexed?: number;
  rgb?: string;
  theme?: number;
  tint?: number;
};

type RawFont = {
  bold?: boolean;
  color?: RawColor;
  italic?: boolean;
  name?: string;
  size?: number;
  underline?: boolean;
};

type RawFill = {
  color?: RawColor;
  patternType?: string;
};

type RawBorderEdge = {
  color?: RawColor;
  style?: string;
};

type RawBorder = Partial<Record<"top" | "right" | "bottom" | "left", RawBorderEdge>>;

type RawCellXf = {
  borderId: number;
  fillId: number;
  fontId: number;
  horizontal?: string;
  vertical?: string;
  wrapText?: boolean;
};

export type SpreadsheetOoxmlSheetPresentation = {
  activeCell: string | null;
  displayScale: number;
  frozenColumns: number;
  frozenRows: number;
  showGridLines: boolean;
  styleIndexByCell: Map<string, number>;
};

export type SpreadsheetOoxmlPresentationReader = {
  defaultFontFamily: string | null;
  defaultFontSize: number | null;
  styles: SpreadsheetCellStyle[];
  readSheet: (
    sheetName: string,
    rowIndices: readonly number[],
    columnIndices: readonly number[],
  ) => Promise<SpreadsheetOoxmlSheetPresentation | null>;
};

/**
 * Open a validated OOXML package and expose only the presentation metadata the
 * read-only worksheet needs. Sheet XML is inflated lazily and serially.
 */
export async function createSpreadsheetOoxmlPresentationReader(
  arrayBuffer: ArrayBuffer,
  workbookSheets: readonly WorkbookSheetRelationship[],
): Promise<SpreadsheetOoxmlPresentationReader | null> {
  try {
    const { default: JSZipRuntime } = await import("jszip");
    const zip = await JSZipRuntime.loadAsync(arrayBuffer, { createFolders: false });
    const relationshipEntry = zip.files["xl/_rels/workbook.xml.rels"];
    if (!relationshipEntry || relationshipEntry.dir) return null;

    const relationshipXml = await readZipEntryText(
      relationshipEntry,
      MAX_RELATIONSHIP_XML_BYTES,
    );
    const targetsById = parseWorkbookRelationships(relationshipXml);
    const entryBySheetName = new Map<string, string>();
    for (const sheet of workbookSheets) {
      const target = targetsById.get(sheet.id);
      const entryName = target ? resolveWorkbookTarget(target) : null;
      if (entryName && zip.files[entryName] && !zip.files[entryName].dir) {
        entryBySheetName.set(sheet.name, entryName);
      }
    }

    const theme = await readTheme(zip);
    const styles = await readStyles(zip, theme);
    const defaultStyle = styles[0];

    return {
      defaultFontFamily: defaultStyle?.fontFamily ?? null,
      defaultFontSize: defaultStyle?.fontSize ?? null,
      styles,
      readSheet: async (sheetName, rowIndices, columnIndices) => {
        const entryName = entryBySheetName.get(sheetName);
        if (!entryName) return null;
        const entry = zip.files[entryName];
        if (!entry || entry.dir) return null;
        const xml = await readZipEntryText(entry, MAX_SHEET_XML_BYTES);
        return parseWorksheetPresentation(
          xml,
          new Set(rowIndices),
          new Set(columnIndices),
        );
      },
    };
  } catch {
    // Presentation metadata is best-effort. SheetJS still supplies a safe,
    // readable value preview when an uncommon style construct is unsupported.
    return null;
  }
}

async function readTheme(zip: JSZip): Promise<Map<number, string>> {
  const entry = zip.files["xl/theme/theme1.xml"];
  if (!entry || entry.dir) return createDefaultTheme();
  try {
    return parseTheme(await readZipEntryText(entry, MAX_THEME_XML_BYTES));
  } catch {
    return createDefaultTheme();
  }
}

async function readStyles(
  zip: JSZip,
  theme: Map<number, string>,
): Promise<SpreadsheetCellStyle[]> {
  const entry = zip.files["xl/styles.xml"];
  if (!entry || entry.dir) return [{}];
  try {
    return parseStyles(await readZipEntryText(entry, MAX_STYLE_XML_BYTES), theme);
  } catch {
    return [{}];
  }
}

async function readZipEntryText(entry: JSZip.JSZipObject, byteLimit: number): Promise<string> {
  const bytes = await entry.async("uint8array");
  if (bytes.byteLength > byteLimit) {
    throw new RangeError(`Spreadsheet XML entry ${entry.name} exceeds its preview budget.`);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function parseWorkbookRelationships(xml: string): Map<string, string> {
  const relationships = new Map<string, string>();
  parseXml(xml, (tag) => {
    if (localName(tag.name) !== "Relationship") return;
    const id = attribute(tag, "Id");
    const target = attribute(tag, "Target");
    if (id && target) relationships.set(id, target);
  });
  return relationships;
}

function resolveWorkbookTarget(target: string): string | null {
  const normalized = target.replace(/^\//, "").replaceAll("\\", "/");
  if (!normalized || normalized.includes("..") || /^[a-z][a-z0-9+.-]*:/i.test(normalized)) {
    return null;
  }
  return normalized.startsWith("xl/") ? normalized : `xl/${normalized}`;
}

function parseTheme(xml: string): Map<number, string> {
  const theme = createDefaultTheme();
  const slots = [
    "dk1",
    "lt1",
    "dk2",
    "lt2",
    "accent1",
    "accent2",
    "accent3",
    "accent4",
    "accent5",
    "accent6",
    "hlink",
    "folHlink",
  ];
  let currentSlot: string | null = null;
  const stack: string[] = [];

  parseXml(
    xml,
    (tag) => {
      const name = localName(tag.name);
      const parent = stack[stack.length - 1];
      if (parent === "clrScheme" && slots.includes(name)) currentSlot = name;
      if (currentSlot && (name === "srgbClr" || name === "sysClr")) {
        const raw = attribute(tag, name === "sysClr" ? "lastClr" : "val");
        const color = normalizeRgb(raw);
        const index = slots.indexOf(currentSlot);
        if (color && index >= 0) theme.set(index, color);
      }
      stack.push(name);
    },
    (tag) => {
      const name = localName(tag.name);
      stack.pop();
      if (name === currentSlot) currentSlot = null;
    },
  );
  return theme;
}

function parseStyles(xml: string, theme: Map<number, string>): SpreadsheetCellStyle[] {
  const fonts: RawFont[] = [];
  const fills: RawFill[] = [];
  const borders: RawBorder[] = [];
  const cellXfs: RawCellXf[] = [];
  const stack: string[] = [];
  let font: RawFont | null = null;
  let fill: RawFill | null = null;
  let border: RawBorder | null = null;
  let borderEdge: keyof RawBorder | null = null;
  let xf: RawCellXf | null = null;

  parseXml(
    xml,
    (tag) => {
      const name = localName(tag.name);
      const parent = stack[stack.length - 1];

      if (name === "font" && parent === "fonts") font = {};
      else if (font) {
        if (name === "b") font.bold = booleanAttribute(tag, "val", true);
        else if (name === "i") font.italic = booleanAttribute(tag, "val", true);
        else if (name === "u") font.underline = booleanAttribute(tag, "val", true);
        else if (name === "name") font.name = attribute(tag, "val") ?? undefined;
        else if (name === "sz") font.size = finiteNumber(attribute(tag, "val")) ?? undefined;
        else if (name === "color") font.color = rawColor(tag);
      }

      if (name === "fill" && parent === "fills") fill = {};
      else if (fill && name === "patternFill") fill.patternType = attribute(tag, "patternType") ?? undefined;
      else if (fill && name === "fgColor") fill.color = rawColor(tag);

      if (name === "border" && parent === "borders") border = {};
      else if (border && isBorderEdge(name)) {
        borderEdge = name;
        border[name] = { style: attribute(tag, "style") ?? undefined };
      } else if (border && borderEdge && name === "color") {
        const edge = border[borderEdge];
        if (edge) edge.color = rawColor(tag);
      }

      if (name === "xf" && parent === "cellXfs") {
        xf = {
          borderId: nonNegativeInteger(attribute(tag, "borderId")),
          fillId: nonNegativeInteger(attribute(tag, "fillId")),
          fontId: nonNegativeInteger(attribute(tag, "fontId")),
        };
      } else if (xf && name === "alignment") {
        xf.horizontal = attribute(tag, "horizontal") ?? undefined;
        xf.vertical = attribute(tag, "vertical") ?? undefined;
        xf.wrapText = booleanAttribute(tag, "wrapText", false);
      }

      stack.push(name);
    },
    (tag) => {
      const name = localName(tag.name);
      if (name === "font" && font) {
        fonts.push(font);
        font = null;
      } else if (name === "fill" && fill) {
        fills.push(fill);
        fill = null;
      } else if (name === "border" && border) {
        borders.push(border);
        border = null;
      } else if (isBorderEdge(name)) {
        borderEdge = null;
      } else if (name === "xf" && xf) {
        cellXfs.push(xf);
        xf = null;
      }
      stack.pop();
    },
  );

  const styles = cellXfs.slice(0, MAX_SPREADSHEET_STYLES).map((cellXf) => (
    normalizeCellStyle(cellXf, fonts, fills, borders, theme)
  ));
  return styles.length > 0 ? styles : [{}];
}

function normalizeCellStyle(
  xf: RawCellXf,
  fonts: RawFont[],
  fills: RawFill[],
  borders: RawBorder[],
  theme: Map<number, string>,
): SpreadsheetCellStyle {
  const font = fonts[xf.fontId];
  const fill = fills[xf.fillId];
  const border = borders[xf.borderId];
  const style: SpreadsheetCellStyle = {};
  const fontColor = resolveColor(font?.color, theme);
  const fillColor = fill?.patternType === "solid" ? resolveColor(fill.color, theme) : null;
  const fontFamily = sanitizeFontFamily(font?.name);
  const fontSize = clamp(font?.size, 7, 72);
  if (fontColor) style.color = fontColor;
  if (fillColor) style.backgroundColor = fillColor;
  if (fontFamily) style.fontFamily = fontFamily;
  if (fontSize !== null) style.fontSize = Math.round(fontSize * (4 / 3) * 10) / 10;
  if (font?.bold) style.bold = true;
  if (font?.italic) style.italic = true;
  if (font?.underline) style.underline = true;
  if (xf.horizontal === "left" || xf.horizontal === "center" || xf.horizontal === "right") {
    style.horizontalAlign = xf.horizontal;
  }
  if (xf.vertical === "top" || xf.vertical === "bottom") style.verticalAlign = xf.vertical;
  else if (xf.vertical === "center") style.verticalAlign = "middle";
  if (xf.wrapText) style.wrapText = true;
  if (border) {
    style.borderTop = normalizeBorder(border.top, theme) ?? undefined;
    style.borderRight = normalizeBorder(border.right, theme) ?? undefined;
    style.borderBottom = normalizeBorder(border.bottom, theme) ?? undefined;
    style.borderLeft = normalizeBorder(border.left, theme) ?? undefined;
  }
  return style;
}

function normalizeBorder(
  edge: RawBorderEdge | undefined,
  theme: Map<number, string>,
): SpreadsheetCellBorder | null {
  if (!edge?.style) return null;
  const excelStyle = edge.style;
  const style = excelStyle === "double"
    ? "double"
    : excelStyle.includes("dash") || excelStyle.includes("Dash")
      ? "dashed"
      : excelStyle === "dotted" || excelStyle === "hair"
        ? "dotted"
        : "solid";
  const width = excelStyle === "thick"
    ? 3
    : excelStyle.startsWith("medium") || excelStyle === "double"
      ? 2
      : 1;
  return {
    color: resolveColor(edge.color, theme) ?? "#d0d7de",
    style,
    width,
  };
}

function parseWorksheetPresentation(
  xml: string,
  rowIndices: Set<number>,
  columnIndices: Set<number>,
): SpreadsheetOoxmlSheetPresentation {
  const result: SpreadsheetOoxmlSheetPresentation = {
    activeCell: null,
    displayScale: 1,
    frozenColumns: 0,
    frozenRows: 0,
    showGridLines: true,
    styleIndexByCell: new Map(),
  };
  let sheetViewSeen = false;

  parseXml(xml, (tag) => {
    const name = localName(tag.name);
    if (name === "sheetView" && !sheetViewSeen) {
      sheetViewSeen = true;
      result.showGridLines = booleanAttribute(tag, "showGridLines", true);
      const zoomPercent = clamp(
        finiteNumber(attribute(tag, "zoomScale")) ?? undefined,
        10,
        400,
      );
      result.displayScale = zoomPercent === null ? 1 : zoomPercent / 100;
      return;
    }
    if (name === "pane" && result.frozenRows === 0 && result.frozenColumns === 0) {
      const state = attribute(tag, "state");
      if (state === "frozen" || state === "frozenSplit") {
        result.frozenRows = Math.max(0, Math.floor(finiteNumber(attribute(tag, "ySplit")) ?? 0));
        result.frozenColumns = Math.max(0, Math.floor(finiteNumber(attribute(tag, "xSplit")) ?? 0));
      }
      return;
    }
    if (name === "selection" && !result.activeCell) {
      result.activeCell = normalizeCellReference(attribute(tag, "activeCell"));
      return;
    }
    if (name !== "c" || result.styleIndexByCell.size >= MAX_SPREADSHEET_MATERIALIZED_CELLS) return;
    const reference = normalizeCellReference(attribute(tag, "r"));
    const styleIndex = nonNegativeInteger(attribute(tag, "s"));
    if (!reference || styleIndex <= 0) return;
    const decoded = decodeCellReference(reference);
    if (!decoded || !rowIndices.has(decoded.rowIndex) || !columnIndices.has(decoded.columnIndex)) return;
    result.styleIndexByCell.set(reference, styleIndex);
  });

  return result;
}

function parseXml(
  xml: string,
  onOpen: (tag: SaxesTagPlain) => void,
  onClose?: (tag: SaxesTagPlain) => void,
): void {
  let depth = 0;
  let startTags = 0;
  const parser = new SaxesParser({ xmlns: false });
  parser.on("doctype", () => {
    throw new Error("DTD declarations are not supported in spreadsheet preview XML.");
  });
  parser.on("opentag", (tag) => {
    depth += 1;
    startTags += 1;
    if (depth > MAX_XML_DEPTH || startTags > MAX_XML_START_TAGS) {
      throw new RangeError("Spreadsheet presentation XML exceeds its parser budget.");
    }
    onOpen(tag);
  });
  parser.on("closetag", (tag) => {
    onClose?.(tag);
    depth -= 1;
  });
  parser.write(xml).close();
}

function attribute(tag: SaxesTagPlain, name: string): string | null {
  const value = tag.attributes[name];
  return typeof value === "string" ? value : null;
}

function booleanAttribute(tag: SaxesTagPlain, name: string, fallback: boolean): boolean {
  const value = attribute(tag, name);
  if (value === null) return fallback;
  return value !== "0" && value !== "false";
}

function rawColor(tag: SaxesTagPlain): RawColor {
  return {
    indexed: finiteNumber(attribute(tag, "indexed")) ?? undefined,
    rgb: attribute(tag, "rgb") ?? undefined,
    theme: finiteNumber(attribute(tag, "theme")) ?? undefined,
    tint: finiteNumber(attribute(tag, "tint")) ?? undefined,
  };
}

function resolveColor(color: RawColor | undefined, theme: Map<number, string>): string | null {
  if (!color) return null;
  let resolved = normalizeRgb(color.rgb);
  if (!resolved && color.theme !== undefined) resolved = theme.get(color.theme) ?? null;
  if (!resolved && color.indexed !== undefined) resolved = INDEXED_COLORS[color.indexed] ?? null;
  if (!resolved) return null;
  return applyTint(resolved, color.tint);
}

function normalizeRgb(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{8}$/i.test(normalized)) return `#${normalized.slice(2).toLowerCase()}`;
  if (/^[0-9a-f]{6}$/i.test(normalized)) return `#${normalized.toLowerCase()}`;
  return null;
}

function applyTint(color: string, tint: number | undefined): string {
  if (tint === undefined || !Number.isFinite(tint) || tint === 0) return color;
  const amount = Math.max(-1, Math.min(1, tint));
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  const adjusted = channels.map((channel) => Math.round(
    amount < 0 ? channel * (1 + amount) : channel + ((255 - channel) * amount),
  ));
  return `#${adjusted.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function createDefaultTheme(): Map<number, string> {
  return new Map([
    [0, "#000000"],
    [1, "#ffffff"],
    [2, "#44546a"],
    [3, "#e7e6e6"],
    [4, "#4472c4"],
    [5, "#ed7d31"],
    [6, "#a5a5a5"],
    [7, "#ffc000"],
    [8, "#5b9bd5"],
    [9, "#70ad47"],
    [10, "#0563c1"],
    [11, "#954f72"],
  ]);
}

const INDEXED_COLORS: Readonly<Record<number, string>> = Object.freeze({
  0: "#000000",
  1: "#ffffff",
  2: "#ff0000",
  3: "#00ff00",
  4: "#0000ff",
  5: "#ffff00",
  6: "#ff00ff",
  7: "#00ffff",
  8: "#000000",
  9: "#ffffff",
  10: "#ff0000",
  11: "#00ff00",
  12: "#0000ff",
  13: "#ffff00",
  14: "#ff00ff",
  15: "#00ffff",
});

function normalizeCellReference(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replaceAll("$", "").toUpperCase();
  return decodeCellReference(normalized) ? normalized : null;
}

function decodeCellReference(reference: string): { rowIndex: number; columnIndex: number } | null {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(reference);
  if (!match) return null;
  let columnIndex = 0;
  for (const character of match[1]) {
    columnIndex = (columnIndex * 26) + character.charCodeAt(0) - 64;
  }
  columnIndex -= 1;
  const rowIndex = Number.parseInt(match[2], 10) - 1;
  if (columnIndex < 0 || columnIndex >= 16_384 || rowIndex < 0 || rowIndex >= 1_048_576) return null;
  return { rowIndex, columnIndex };
}

function nonNegativeInteger(value: string | null): number {
  const parsed = finiteNumber(value);
  return parsed === null ? 0 : Math.max(0, Math.floor(parsed));
}

function finiteNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number | undefined, minimum: number, maximum: number): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return Math.max(minimum, Math.min(maximum, value));
}

function sanitizeFontFamily(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/[^\p{L}\p{N} ._+-]/gu, "").trim().slice(0, 80);
  return normalized || null;
}

function isBorderEdge(value: string): value is keyof RawBorder {
  return value === "top" || value === "right" || value === "bottom" || value === "left";
}

function localName(value: string): string {
  const separator = value.lastIndexOf(":");
  return separator < 0 ? value : value.slice(separator + 1);
}
