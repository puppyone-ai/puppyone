export type MarkdownImageSize = Readonly<{ width: number; height: number | null }>;

/** `100` sets the width and `100x50` both axes; anything else is not a size. */
export function parseMarkdownImageSize(value: string | null): MarkdownImageSize | null {
  const match = /^(\d{1,4})(?:x(\d{1,4}))?$/i.exec(value?.trim() ?? "");
  if (!match) return null;
  return { width: Number(match[1]), height: match[2] ? Number(match[2]) : null };
}

/** Standard image alt text may end in `|size`; the rest stays the description. */
export function splitMarkdownImageAlt(alt: string): {
  alt: string;
  size: MarkdownImageSize | null;
} {
  const pipe = alt.lastIndexOf("|");
  const size = pipe < 0 ? null : parseMarkdownImageSize(alt.slice(pipe + 1));
  return size ? { alt: alt.slice(0, pipe).trim(), size } : { alt, size: null };
}
