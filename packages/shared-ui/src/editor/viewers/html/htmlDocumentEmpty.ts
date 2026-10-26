import { parse, type DefaultTreeAdapterTypes as Tree } from "parse5";

/** Only identify a definitely empty document. Script-driven pages and CSS
 * generated content must still run in the interactive preview. */
export function isHtmlDocumentEmpty(source: string): boolean {
  const pending: Tree.Node[] = [parse(source)];
  let body: Tree.Element | undefined;
  while (pending.length) {
    const node = pending.pop()!;
    if ("tagName" in node) {
      if (["script", "style", "link"].includes(node.tagName)) return false;
      if (node.tagName === "meta" && node.attrs.some((entry) => entry.name === "http-equiv"
        && entry.value.toLowerCase() === "refresh")) return false;
      if (node.tagName === "body") body = node;
    }
    if ("childNodes" in node) pending.push(...node.childNodes);
  }
  return !body?.childNodes.some((node) => "tagName" in node
    || node.nodeName === "#text" && "value" in node && node.value.trim().length > 0);
}
