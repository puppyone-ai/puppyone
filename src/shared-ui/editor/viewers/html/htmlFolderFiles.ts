/** Plain-text data a page may keep beside itself. Never pages, scripts or hidden files. */
const HTML_FOLDER_FILE_EXTENSIONS = new Set(["md", "markdown", "txt", "json", "csv", "tsv", "yaml", "yml"]);

export function isHtmlFolderFileName(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 255) return false;
  if (value.startsWith(".") || /[/\\:\u0000-\u001f\u007f]/.test(value)) return false;
  const extension = /\.([^.]+)$/.exec(value)?.[1]?.toLowerCase();
  return !!extension && HTML_FOLDER_FILE_EXTENSIONS.has(extension);
}
