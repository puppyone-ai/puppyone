export function estimateCodeBlockLayoutHeight(code: string): number {
  const lineCount = Math.max(1, code.split("\n").length);
  return clampLayoutHeight(54 + lineCount * 20, 74, 1600);
}

export function estimateMermaidLayoutHeight(code: string): number {
  const lineCount = Math.max(1, code.split("\n").length);
  return clampLayoutHeight(120 + lineCount * 18, 180, 1400);
}

function clampLayoutHeight(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
