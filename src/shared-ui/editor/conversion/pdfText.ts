import { escapeMarkdown, tableToMarkdown } from "./output";
import type { ConversionTable } from "./types";

export type PdfTextItem = { str: string; transform: number[]; width: number; height: number; hasEOL: boolean };

/** Conservative geometry heuristic for ordinary horizontal text. Tables always require user review. */
export function extractPdfPage(items: PdfTextItem[], page: number) {
  const lines: { y: number; height: number; items: PdfTextItem[] }[] = [];
  for (const item of items.filter(item => item.str.trim())) {
    const y = item.transform[5];
    const last = lines.find(line => Math.abs(line.y - y) < Math.max(2, Math.min(line.height, item.height) * 0.35));
    if (last) last.items.push(item);
    else lines.push({ y, height: item.height || 12, items: [item] });
  }
  lines.sort((a, b) => b.y - a.y);
  const cells = lines.map(line => {
    const sorted = line.items.sort((a, b) => a.transform[4] - b.transform[4]);
    const chunks: { x: number; text: string }[] = [];
    let previous: PdfTextItem | undefined;
    for (const item of sorted) {
      const gap = previous ? item.transform[4] - previous.transform[4] - previous.width : 0;
      if (!previous || gap > Math.max(24, line.height * 2)) chunks.push({ x: item.transform[4], text: item.str });
      else chunks[chunks.length - 1].text += (gap > 1 && !/\s$/.test(previous.str) && !/^\s/.test(item.str)
        && !(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(previous.str) && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(item.str)) ? " " : "") + item.str;
      previous = item;
    }
    return chunks;
  });
  const tables: ConversionTable[] = [];
  const output: string[] = [];
  for (let i = 0; i < cells.length;) {
    const start = i;
    const first = cells[i];
    if (first.length > 1) {
      while (i + 1 < cells.length && cells[i + 1].length === first.length
        && cells[i + 1].every((cell, column) => Math.abs(cell.x - first[column].x) < 8)
        && lines[i].y - lines[i + 1].y < Math.max(50, lines[i].height * 4)) i++;
    }
    if (i - start >= 2) {
      const table = { id: `page-${page}-table-${tables.length + 1}`, page, rows: cells.slice(start, i + 1).map(row => row.map(cell => cell.text.trim())) };
      tables.push(table); output.push(tableToMarkdown(table));
    } else {
      for (let row = start; row <= i; row++) output.push(escapeMarkdown(cells[row].map(cell => cell.text).join("    ")));
    }
    i++;
  }
  return { markdown: output.join("\n\n"), tables };
}
