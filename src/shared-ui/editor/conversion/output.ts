import type { ConversionTable } from "./types";

export function tableToCsv(table: ConversionTable): string {
  return table.rows.map(row => row.map(value => /[",\r\n]/.test(value)
    ? `"${value.replace(/"/g, '""')}"` : value).join(",")).join("\r\n") + "\r\n";
}

export function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}\[\]<>#!|~$&=+.-])/g, "\\$1");
}

export function tableToMarkdown(table: ConversionTable): string {
  const rows = (table.markdownRows ?? table.rows.map(row => row.map(escapeMarkdown)))
    .map(row => `| ${row.map(cell => cell.replace(/\r?\n/g, "<br>")).join(" | ")} |`);
  if (!rows.length) return "";
  rows.splice(1, 0, `| ${table.rows[0].map(() => "---").join(" | ")} |`);
  return rows.join("\n");
}
