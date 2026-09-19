import { parseFragment, serialize, type DefaultTreeAdapterTypes as Tree } from "parse5";
import { HTML_FRAME_BRIDGE } from "./htmlFrameBridge";
import { attribute, escapeHtmlAttribute, HTML_TARGET_ATTRIBUTE, isHtmlElement, type HtmlSourceIndex } from "./htmlSourceIndex";

const REMOVED = new Set("script noscript iframe frame frameset object embed applet template base meta portal fencedframe".split(" "));
const URL_ATTRIBUTES = new Set(["href", "src", "poster", "background", "xlink:href"]);
const REMOVED_ATTRIBUTES = new Set(["srcdoc", "nonce", "integrity", "action", "formaction", "target", "ping", "download", "autofocus", "contenteditable", "is", "srcset", "imagesrcset", "http-equiv"]);

export function resolveHtmlBase(fileUrl: string | null | undefined, sourceBase: string | null): string | null {
  try {
    const base = sourceBase ? new URL(sourceBase, fileUrl ?? undefined) : fileUrl ? new URL(fileUrl) : null;
    return base && ["https:", "puppyone-local:"].includes(base.protocol) ? base.href : null;
  } catch { return null; }
}

/** Serializes only a disposable, sanitized projection. Never use this as a source serializer. */
export function buildHtmlEditingProjection(index: HtmlSourceIndex, fileUrl: string | null | undefined, session: string): string {
  const base = resolveHtmlBase(fileUrl, index.baseHref);
  const clean = (parent: Tree.ParentNode) => {
    parent.childNodes = parent.childNodes.filter((node) => {
      if (node.nodeName === "#documentType" || node.nodeName === "#comment" || node.nodeName === "#text") return true;
      if (!isHtmlElement(node) || REMOVED.has(node.tagName)) return false;
      if (node.tagName === "link" && (attribute(node, "rel")?.toLowerCase() !== "stylesheet")) return false;
      node.attrs = node.attrs.filter((entry) => {
        if (entry.name.startsWith("on") || entry.name.startsWith("data-puppyone-") || REMOVED_ATTRIBUTES.has(entry.name)) return false;
        if (URL_ATTRIBUTES.has(entry.name)) {
          // Navigation is disabled. Images and styles may only use admitted resource protocols.
          if (entry.name === "href" && node.tagName !== "link") return false;
          try {
            const url = new URL(entry.value, base ?? "https://unavailable.invalid/");
            return ["https:", "puppyone-local:"].includes(url.protocol)
              || entry.name === "src" && node.tagName === "img" && /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(entry.value);
          } catch { return false; }
        }
        return true;
      });
      if (["input", "textarea", "select", "button"].includes(node.tagName)) node.attrs.push({ name: "tabindex", value: "-1" });
      const targetId = index.nodes.get(node);
      if (targetId) {
        node.attrs.push({ name: HTML_TARGET_ATTRIBUTE, value: targetId });
        node.attrs.push({ name: "tabindex", value: "0" });
      }
      clean(node);
      return true;
    });
  };
  clean(index.tree);
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = ["default-src 'none'", `script-src 'nonce-${nonce}'`, "script-src-attr 'none'",
    "style-src 'unsafe-inline' https: puppyone-local:", "img-src data: https: puppyone-local:",
    "font-src data: https: puppyone-local:", "media-src https: puppyone-local:",
    "connect-src 'none'", "object-src 'none'", "frame-src 'none'", "form-action 'none'",
    "base-uri https: puppyone-local:"].join("; ");
  const head = `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}">`
    + (base ? `<base href="${escapeHtmlAttribute(base)}">` : "")
    + `<style>[${HTML_TARGET_ATTRIBUTE}]{cursor:default}input,textarea,select{pointer-events:none}</style>`;
  const script = `<script nonce="${nonce}">const SESSION=${JSON.stringify(session)};${HTML_FRAME_BRIDGE}</script>`;
  // Mutate parsed nodes, never search markup strings that can also occur in CSS or quoted attributes.
  const html = index.tree.childNodes.find((node): node is Tree.Element => isHtmlElement(node) && node.tagName === "html")!;
  const headNode = html.childNodes.find((node): node is Tree.Element => isHtmlElement(node) && node.tagName === "head")!;
  const bodyNode = html.childNodes.find((node): node is Tree.Element => isHtmlElement(node) && node.tagName === "body")!;
  headNode.childNodes.unshift(...parseFragment(head).childNodes);
  bodyNode.childNodes.push(...parseFragment(script).childNodes);
  return serialize(index.tree);
}
