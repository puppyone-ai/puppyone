declare module "css-tree" {
  export interface CssList { toArray(): CssNode[]; replace(item: unknown, replacement: CssList): void; }
  export interface CssNode { type: string; value?: string; name?: string; prelude?: CssNode; children?: CssList; }
  export interface CssWalkContext { atrule: CssNode | null; }
  export function parse(source: string, options?: { context?: string }): CssNode;
  export function generate(node: CssNode): string;
  export function walk(node: CssNode, callback: (this: CssWalkContext, node: CssNode, item: unknown, list: CssList | null) => void): void;
}
