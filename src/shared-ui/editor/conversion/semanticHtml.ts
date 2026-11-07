import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { escapeMarkdown, tableToMarkdown } from "./output";
import { DocumentConversionError, type ConversionTable, type ConversionWarning } from "./types";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
const children = (node: Node): Node[] => "childNodes" in node ? node.childNodes : [];
const tag = (node: Node) => "tagName" in node ? node.tagName : "";
const attr = (node: Node, name: string) => "attrs" in node ? node.attrs.find(item => item.name === name)?.value ?? "" : "";
function text(node: Node, depth = 0): string {
  if (depth > 100) throw new DocumentConversionError("limit");
  if ("value" in node) return node.value;
  if (tag(node) === "br") return "\n";
  if (tag(node) === "img") return attr(node, "alt");
  const value = children(node).map(child => text(child, depth + 1)).join("");
  return ["p", "div", "li", "tr"].includes(tag(node)) ? `${value}\n` : value;
}

/** Converts detached semantic HTML to a safe Markdown subset; never attaches parser output to the DOM. */
export function convertSemanticHtml(html: string) {
  const tables: ConversionTable[] = [];
  const warnings: ConversionWarning[] = [];
  const warn = (code: string) => { if (!warnings.some(item => item.code === code)) warnings.push({ code }); };
  let visited = 0;
  const render = (node: Node, depth = 0): string => {
    if (++visited > 200_000 || depth > 100) throw new DocumentConversionError("limit");
    if ("value" in node) return escapeMarkdown(node.value);
    const name = tag(node);
    if (["script", "style", "iframe", "object", "embed", "form"].includes(name)) return "";
    if (name === "table") {
      const table = readTable(node as Element, tables.length, warn, cell => children(cell).map(child => {
        if (tag(child) === "table") { warn("docx-review"); return escapeMarkdown(text(child)); }
        return render(child, depth + 1);
      }).join("").trim().replace(/\n{2,}/g, "\n"));
      tables.push(table);
      return `\n\n${tableToMarkdown(table)}\n\n`;
    }
    const body = () => children(node).map(child => render(child, depth + 1)).join("");
    if (/^h[1-6]$/.test(name)) return `\n\n${"#".repeat(Number(name[1]))} ${body().trim()}\n\n`;
    if (name === "p" || name === "div") return `\n\n${body().trim()}\n\n`;
    if (name === "br") return "  \n";
    if (name === "strong" || name === "b") return `**${body()}**`;
    if (name === "em" || name === "i") return `*${body()}*`;
    if (name === "s" || name === "del" || name === "strike") return `~~${body()}~~`;
    if (name === "u" || name === "sup" || name === "sub") return `<${name}>${body()}</${name}>`;
    if (name === "code") {
      const value = text(node); let fence = "`";
      while (value.includes(fence)) fence += "`";
      return `${fence} ${value} ${fence}`;
    }
    if (name === "a") {
      const href = attr(node, "href");
      return /^(https?:\/\/|mailto:)/i.test(href) && !/[\s<>\u0000-\u001f]/.test(href)
        ? `[${body()}](${href.replace(/\(/g, "%28").replace(/\)/g, "%29")})` : body();
    }
    if (name === "img") {
      const src = attr(node, "src");
      if (!/^assets\/image-\d+\.(png|jpg|gif|webp)$/.test(src)) { warn("image-omitted"); return ""; }
      return `![${escapeMarkdown(attr(node, "alt"))}](${src})`;
    }
    if (name === "ul" || name === "ol") {
      let index = Number(attr(node, "start")) || 1;
      return "\n\n" + children(node).filter(child => tag(child) === "li").map(child => {
        const value = render(child, depth + 1).trim();
        const prefix = name === "ol" ? `${index++}. ` : "- ";
        return prefix + value.replace(/\n/g, "\n" + " ".repeat(prefix.length));
      }).join("\n") + "\n\n";
    }
    if (name === "blockquote") return "\n\n" + body().trim().replace(/^/gm, "> ") + "\n\n";
    if (name === "hr") return "\n\n---\n\n";
    return body();
  };
  const markdown = render(parseFragment(html)).replace(/\n[ \t]+\n/g, "\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  return { markdown, tables, warnings };
}

function readTable(node: Element, index: number, warn: (code: string) => void, renderCell: (cell: Node) => string): ConversionTable {
  const rows: string[][] = [];
  const markdownRows: string[][] = [];
  const covered = new Set<string>();
  const sourceRows: Node[] = [];
  const collect = (parent: Node, depth = 0) => {
    if (depth > 10) throw new DocumentConversionError("limit");
    for (const child of children(parent)) {
      if (tag(child) === "tr") sourceRows.push(child);
      else if (["thead", "tbody", "tfoot"].includes(tag(child))) collect(child, depth + 1);
    }
  };
  collect(node);
  if (sourceRows.length > 5000) throw new DocumentConversionError("limit");
  sourceRows.forEach((row, y) => {
    rows[y] ??= [];
    markdownRows[y] ??= [];
    let x = 0;
    for (const cell of children(row).filter(item => ["td", "th"].includes(tag(item)))) {
      while (covered.has(`${y}:${x}`)) { rows[y][x] = ""; x++; }
      const cols = Math.max(1, Number(attr(cell, "colspan")) || 1);
      const span = Math.max(1, Number(attr(cell, "rowspan")) || 1);
      if (!Number.isInteger(cols) || !Number.isInteger(span) || x + cols > 100 || y + span > 5000) throw new DocumentConversionError("limit");
      if (cols > 1 || span > 1) warn("merged-cells");
      rows[y][x] = text(cell).trim();
      markdownRows[y][x] = renderCell(cell);
      for (let dy = 0; dy < span; dy++) for (let dx = 0; dx < cols; dx++) {
        covered.add(`${y + dy}:${x + dx}`);
        if (dx || dy) { rows[y + dy] ??= []; rows[y + dy][x + dx] = ""; markdownRows[y + dy] ??= []; markdownRows[y + dy][x + dx] = ""; }
      }
      x += cols;
    }
  });
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (rows.length * width > 50_000) throw new DocumentConversionError("limit");
  return { id: `table-${String(index + 1).padStart(3, "0")}`, rows: rows.map(row => Array.from({ length: width }, (_, i) => row[i] ?? "")),
    markdownRows: markdownRows.map(row => Array.from({ length: width }, (_, i) => row[i] ?? "")) };
}
