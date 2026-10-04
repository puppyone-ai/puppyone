import { parse, parseFragment, serialize, type DefaultTreeAdapterTypes as Tree } from "parse5";
import { parse as parseCss, walk, generate } from "css-tree";
import { resolveMarkdownAssetPath } from "@puppyone/shared-ui";

type Resources = {
  root: string;
  sign: (path: string) => Promise<string>;
  readText: (path: string) => Promise<{ content: string }>;
};
const MAX_REFERENCES = 64;
const MAX_CSS_BYTES = 512 * 1024;
function wrapImport(condition: { type: string }, syntax: string, rules: string): string {
  if (condition.type === "MediaQueryList") return `@media ${syntax}{${rules}}`;
  if (syntax.startsWith("supports(")) return `@supports ${syntax.slice(8)}{${rules}}`;
  if (syntax === "layer") return `@layer{${rules}}`;
  if (syntax.startsWith("layer(")) return `@layer ${syntax.slice(6, -1)}{${rules}}`;
  throw new Error("Unsupported HTML stylesheet import condition.");
}

/** Rewrite only a disposable projection. Stored HTML/CSS and editor source
 * retain their portable paths; no token or preview URL is persisted. */
export async function projectCloudHtml(path: string, source: string, resources: Resources,
  signal: AbortSignal, baseHref?: string | null): Promise<string> {
  const tree = parse(source);
  const pending: Tree.ParentNode[] = [tree];
  const changes: Promise<void>[] = [];
  const signed = new Map<string, Promise<string>>();
  let count = 0;
  const workspacePath = (from: string, href: string) => {
    if (/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(href.trim())) return null;
    const target = resolveMarkdownAssetPath(from, href, resources.root);
    if (!target) throw new Error("HTML resource is outside this Cloud workspace.");
    return target;
  };
  const sign = async (from: string, href: string) => {
    signal.throwIfAborted();
    const target = workspacePath(from, href);
    if (!target) return href;
    if (!signed.has(target)) {
      if (++count > MAX_REFERENCES) throw new Error("HTML resource budget exceeded.");
      signed.set(target, resources.sign(target));
    }
    const url = await signed.get(target)!;
    signal.throwIfAborted(); return url;
  };
  const css = async (from: string, value: string, context = "stylesheet", depth = 0): Promise<string> => {
    if (depth > 4) throw new Error("HTML stylesheet dependency budget exceeded.");
    if (new TextEncoder().encode(value).byteLength > MAX_CSS_BYTES) throw new Error("HTML stylesheet budget exceeded.");
    const ast = parseCss(value, { context });
    const urls: Promise<void>[] = [];
    walk(ast, function (node, item, list) {
      if (node.type === "Atrule" && node.name?.toLowerCase() === "import") {
        const [reference, ...conditions] = node.prelude?.children?.toArray() ?? [];
        const target = reference?.value ? workspacePath(from, reference.value) : null;
        if (target && list && item) urls.push((async () => {
          if (++count > MAX_REFERENCES) throw new Error("HTML resource budget exceeded.");
          const imported = await css(target, (await resources.readText(target)).content, "stylesheet", depth + 1);
          let projected = imported;
          // Keep import media/layer/supports qualifiers around the inlined rules.
          for (const condition of conditions.reverse()) {
            const syntax = generate(condition);
            projected = wrapImport(condition, syntax, projected);
          }
          list.replace(item, parseCss(projected).children!);
        })());
      }
      if (this.atrule?.name?.toLowerCase() === "import") return;
      if (node.type === "Url" && node.value) {
        const href = node.value;
        urls.push(sign(from, href).then((url) => { node.value = url; }));
      }
    });
    await Promise.all(urls); return generate(ast);
  };
  let from = path;
  if (baseHref && !/^(?:[a-z][\w+.-]*:|\/\/)/i.test(baseHref)) {
    const base = workspacePath(path, `${baseHref.replace(/\/?$/, "/")}__document__.html`);
    if (base) from = base;
  }
  const externalBase = !!baseHref && /^(?:https?:|\/\/)/i.test(baseHref);
  while (pending.length) {
    const parent = pending.pop()!;
    for (const node of parent.childNodes) {
      if ("childNodes" in node) pending.push(node);
      if (!("tagName" in node) || externalBase) continue;
      if (node.tagName === "base") node.attrs = node.attrs.filter((attribute) => attribute.name !== "href");
      for (const attribute of node.attrs) {
        if (["src", "poster", "background", "xlink:href"].includes(attribute.name)) {
          changes.push(sign(from, attribute.value).then((url) => { attribute.value = url; }));
        } else if (attribute.name === "style") {
          changes.push(css(from, attribute.value, "declarationList").then((value) => { attribute.value = value; }));
        }
      }
      if (node.tagName === "style") {
        const text = node.childNodes.filter((child): child is Tree.TextNode => child.nodeName === "#text").map((child) => child.value).join("");
        changes.push(css(from, text).then((value) => { node.childNodes = parseFragment(`<style>${value.replaceAll("</", "<\\/")}</style>`).childNodes.filter((child): child is Tree.Element => "tagName" in child)[0]!.childNodes; }));
      }
      if (node.tagName === "link" && node.attrs.some((attribute) => attribute.name === "rel" && attribute.value.toLowerCase() === "stylesheet")) {
        const href = node.attrs.find((attribute) => attribute.name === "href");
        const target = href ? workspacePath(from, href.value) : null;
        if (target) changes.push((async () => {
          if (++count > MAX_REFERENCES) throw new Error("HTML resource budget exceeded.");
          const value = await css(target, (await resources.readText(target)).content);
          signal.throwIfAborted();
          const style = parseFragment(`<style>${value.replaceAll("</", "<\\/")}</style>`).childNodes.find((child): child is Tree.Element => "tagName" in child)!;
          node.tagName = "style"; node.attrs = style.attrs; node.childNodes = style.childNodes;
        })());
      }
    }
  }
  await Promise.all(changes);
  signal.throwIfAborted(); return serialize(tree);
}


type ProjectionServices = Resources & {
  assertCurrent: () => void;
  revokeResource: (url: string) => Promise<unknown> | unknown;
  createDocument: (request: { content: string; interactive?: boolean }) => Promise<{ url: string }>;
  revokeDocument: (url: string) => Promise<unknown>;
};

/** One projection owns both its document and every signed asset. Pending
 * signatures arriving after cancellation are released instead of orphaned. */
export async function createCloudHtmlProjection(path: string, content: string, services: ProjectionServices,
  signal: AbortSignal, options?: { interactive: boolean; baseHref?: string | null }) {
  const resources: string[] = [];
  let disposed = false;
  let documentUrl: string | undefined;
  const close = async () => {
    if (disposed) return;
    disposed = true;
    try {
      if (documentUrl) await services.revokeDocument(documentUrl);
    } finally {
      await Promise.all(resources.splice(0).map(services.revokeResource));
    }
  };
  try {
    const projected = await projectCloudHtml(path, content, { ...services,
      sign: async (resource) => {
        const url = await services.sign(resource);
        if (disposed || signal.aborted) {
          await services.revokeResource(url);
          throw new Error("Cloud HTML projection was cancelled.");
        }
        resources.push(url);
        return url;
      },
    }, signal, options?.baseHref);
    services.assertCurrent(); signal.throwIfAborted();
    const lease = await services.createDocument({ content: projected, interactive: options?.interactive });
    documentUrl = lease.url;
    services.assertCurrent(); signal.throwIfAborted();
    return { url: lease.url, close };
  } catch (error) {
    await close();
    throw error;
  }
}
