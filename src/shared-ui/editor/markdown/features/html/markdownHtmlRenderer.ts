import { markdownLanguage } from "@codemirror/lang-markdown";
import type { SyntaxNode } from "@lezer/common";
import type { MarkdownParser } from "@lezer/markdown";
import { markdownInlineSyntaxParserExtension } from "../inline-syntax/inlineSyntaxParser";
import emojiShortcodes from "../inline-syntax/emojiShortcodes.generated.json";

const EMOJI = emojiShortcodes as Readonly<Record<string, string>>;
const parser = (markdownLanguage.parser as MarkdownParser).configure([markdownInlineSyntaxParserExtension]);

/** Marks an embed target, which resolves through the link graph rather than a path. */
export const MARKDOWN_EMBED_TARGET_PREFIX = "embed-target:";

export type MarkdownHtmlRenderOptions = Readonly<{
  resolveReference?: (label: string) => string | null;
}>;

/**
 * Markdown to an HTML string using the editor's own parser. Raw HTML passes
 * through untouched, because only the browser can build the tree when a tag
 * opens in one block and closes in another. The sanitizer is what makes the
 * result safe, so every caller must send this string through it.
 */
export function renderMarkdownBlocksToHtml(
  source: string,
  options: MarkdownHtmlRenderOptions = {},
): string {
  return new Renderer(source, options).blocks(parser.parse(source).topNode);
}

export function renderMarkdownInlineToHtml(
  source: string,
  options: MarkdownHtmlRenderOptions = {},
): string {
  // A word joiner keeps a leading `#` or `-` from starting a block here.
  const anchored = `⁠${source}`;
  const renderer = new Renderer(anchored, options);
  const lines: string[] = [];
  for (let node = parser.parse(anchored).topNode.firstChild; node; node = node.nextSibling) {
    if (node.name === "Paragraph") lines.push(renderer.inline(node, node.from + (node.from === 0 ? 1 : 0), node.to));
  }
  return lines.join("<br>");
}

export function escapeMarkdownHtmlText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(text: string): string {
  return escapeMarkdownHtmlText(text).replace(/"/g, "&quot;");
}

class Renderer {
  constructor(
    private readonly source: string,
    private readonly options: MarkdownHtmlRenderOptions,
  ) {}

  private slice(from: number, to: number): string {
    return this.source.slice(from, to);
  }

  private children(node: SyntaxNode): string {
    let html = "";
    for (let child = node.firstChild; child; child = child.nextSibling) html += this.block(child);
    return html;
  }

  blocks(node: SyntaxNode): string {
    return this.children(node);
  }

  private block(node: SyntaxNode): string {
    const heading = /^(?:ATXHeading|SetextHeading)([1-6])$/.exec(node.name);
    if (heading) return `<h${heading[1]}>${this.inline(node).trim()}</h${heading[1]}>\n`;

    switch (node.name) {
      case "Paragraph":
        return `<p>${this.inline(node)}</p>\n`;
      case "BulletList":
        return `<ul>\n${this.children(node)}</ul>\n`;
      case "OrderedList": {
        const first = this.slice(node.from, node.to).match(/^\s*(\d+)/)?.[1] ?? "1";
        return `<ol${first === "1" ? "" : ` start="${Number(first)}"`}>\n${this.children(node)}</ol>\n`;
      }
      case "ListItem":
        return `<li>${this.listItem(node)}</li>\n`;
      case "Blockquote":
        return `<blockquote>\n${this.children(node)}</blockquote>\n`;
      case "FencedCode":
      case "CodeBlock": {
        const lines = node.getChildren("CodeText").map(({ from, to }) => this.slice(from, to));
        return `<pre><code>${escapeMarkdownHtmlText(lines.join("\n"))}</code></pre>\n`;
      }
      case "HorizontalRule":
        return "<hr>\n";
      case "HTMLBlock":
        return `${this.slice(node.from, node.to)}\n`;
      case "Table":
        return this.table(node);
      default:
        return "";
    }
  }

  /** A single paragraph is a tight item; the wrapper would only add a margin. */
  private listItem(node: SyntaxNode): string {
    const content: SyntaxNode[] = [];
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name !== "ListMark") content.push(child);
    }
    const [only] = content;
    if (content.length === 1 && only?.name === "Paragraph") return this.inline(only);
    if (content.length === 1 && only?.name === "Task") return this.task(only);
    return `\n${content.map((child) => (child.name === "Task" ? `<p>${this.task(child)}</p>\n` : this.block(child))).join("")}`;
  }

  private task(node: SyntaxNode): string {
    const marker = node.getChild("TaskMarker");
    const checked = marker && /x/i.test(this.slice(marker.from, marker.to));
    return `${checked ? "☑" : "☐"} ${this.inline(node, marker?.to ?? node.from, node.to).trimStart()}`;
  }

  private table(node: SyntaxNode): string {
    const rows: string[] = [];
    for (let row = node.firstChild; row; row = row.nextSibling) {
      if (row.name !== "TableHeader" && row.name !== "TableRow") continue;
      const tag = row.name === "TableHeader" ? "th" : "td";
      const cells = row.getChildren("TableCell").map((cell) => `<${tag}>${this.inline(cell).trim()}</${tag}>`);
      rows.push(`<tr>${cells.join("")}</tr>`);
    }
    return `<table>\n${rows.join("\n")}\n</table>\n`;
  }

  inline(node: SyntaxNode, from = node.from, to = node.to): string {
    let html = "";
    let position = from;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.from < from || child.to > to) continue;
      html += escapeMarkdownHtmlText(this.slice(position, child.from));
      html += this.inlineNode(child);
      position = child.to;
    }
    return html + escapeMarkdownHtmlText(this.slice(position, to));
  }

  private wrapped(node: SyntaxNode, tag: string): string {
    return `<${tag}>${this.inline(node)}</${tag}>`;
  }

  private inlineNode(node: SyntaxNode): string {
    if (node.name.endsWith("ImageEmbed")) return this.embeddedImage(node);
    switch (node.name) {
      case "Emphasis":
        return this.wrapped(node, "em");
      case "StrongEmphasis":
        return this.wrapped(node, "strong");
      case "Strikethrough":
      case "Subscript":
        return this.wrapped(node, "del");
      case "Highlight":
        return this.wrapped(node, "mark");
      case "InlineCode": {
        const marks = node.getChildren("CodeMark");
        const text = this.slice(marks[0]?.to ?? node.from, marks[marks.length - 1]?.from ?? node.to);
        return `<code>${escapeMarkdownHtmlText(text)}</code>`;
      }
      case "Link":
        return this.link(node);
      case "Image":
        return this.image(node);
      case "Autolink": {
        const url = node.getChild("URL");
        return url ? this.anchor(this.slice(url.from, url.to), this.slice(url.from, url.to)) : "";
      }
      case "URL": {
        const text = this.slice(node.from, node.to);
        return this.anchor(/^www\./i.test(text) ? `https://${text}` : text, escapeMarkdownHtmlText(text));
      }
      case "HTMLTag":
      case "Entity":
        return this.slice(node.from, node.to);
      case "Escape":
        return escapeMarkdownHtmlText(this.slice(node.from + 1, node.to));
      case "HardBreak":
        return "<br>\n";
      case "Emoji":
        return EMOJI[this.slice(node.from + 1, node.to - 1)]
          ?? escapeMarkdownHtmlText(this.slice(node.from, node.to));
      case "Comment":
      case "ProcessingInstruction":
      case "PercentComment":
      case "CodeMark":
      case "EmphasisMark":
      case "HeaderMark":
      case "HighlightMark":
      case "LinkMark":
      case "QuoteMark":
      case "StrikethroughMark":
      case "SubscriptMark":
        return "";
      default:
        return this.inline(node);
    }
  }

  private anchor(href: string, label: string): string {
    return `<a href="${escapeAttribute(href)}">${label}</a>`;
  }

  private reference(node: SyntaxNode, fallbackLabel: string): string | null {
    const label = node.getChild("LinkLabel");
    const explicit = label ? this.slice(label.from + 1, label.to - 1).trim() : "";
    return this.options.resolveReference?.(explicit || fallbackLabel) ?? null;
  }

  private link(node: SyntaxNode): string {
    const marks = node.getChildren("LinkMark");
    const labelFrom = marks[0]?.to ?? node.from;
    const labelTo = marks[1]?.from ?? node.to;
    const url = node.getChild("URL");
    const href = url
      ? this.slice(url.from, url.to).replace(/^<|>$/g, "")
      : this.reference(node, this.slice(labelFrom, labelTo));
    // An unresolved reference is literal text and may still hold a wiki link.
    if (!href) return escapeMarkdownHtmlText(this.slice(node.from, node.to));
    return this.anchor(href, this.inline(node, labelFrom, labelTo));
  }

  private image(node: SyntaxNode): string {
    const marks = node.getChildren("LinkMark");
    const alt = this.slice(marks[0]?.to ?? node.from, marks[1]?.from ?? node.to);
    const url = node.getChild("URL");
    const href = url ? this.slice(url.from, url.to).replace(/^<|>$/g, "") : this.reference(node, alt);
    if (!href) return escapeMarkdownHtmlText(this.slice(node.from, node.to));
    return `<img src="${escapeAttribute(href)}" alt="${escapeAttribute(alt)}">`;
  }

  private embeddedImage(node: SyntaxNode): string {
    let target = "";
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name.endsWith("ImageTarget")) target = this.slice(child.from, child.to).trim();
    }
    return `<img src="${escapeAttribute(`${MARKDOWN_EMBED_TARGET_PREFIX}${target}`)}" alt="${escapeAttribute(target)}">`;
  }
}
