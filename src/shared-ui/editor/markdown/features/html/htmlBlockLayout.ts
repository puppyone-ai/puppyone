const HTML_WIDGET_VERTICAL_PADDING_PX = 32;

/** Pure, deterministic height reservation for offscreen HTML block widgets. */
export function estimateHtmlBlockLayoutHeight(source: string): number {
  const lineEstimate = Math.max(1, source.split("\n").length) * 24;
  const imageEstimate = estimateHtmlImageHeight(source);
  return clampHeight(
    Math.max(80, lineEstimate + imageEstimate) + HTML_WIDGET_VERTICAL_PADDING_PX,
    112,
    2400,
  );
}

function estimateHtmlImageHeight(source: string): number {
  const imageTags = source.match(/<img\b[^>]*>/gi) ?? [];
  return imageTags.reduce((total, tag) => {
    const explicitHeight = readPositiveAttribute(tag, "height");
    if (explicitHeight) return total + explicitHeight;
    const src = readAttribute(tag, "src");
    return total + (/img\.shields\.io|badge/i.test(src) ? 24 : 320);
  }, 0);
}

function readPositiveAttribute(tag: string, name: string): number | null {
  const value = Number.parseFloat(readAttribute(tag, name));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function readAttribute(tag: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function clampHeight(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
