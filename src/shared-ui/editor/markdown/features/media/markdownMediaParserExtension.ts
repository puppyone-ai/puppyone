import type { InlineContext, MarkdownConfig } from "@lezer/markdown";
import { tags } from "@lezer/highlight";
import { scanObsidianMediaEmbedAt } from "./obsidianMediaEmbed";

/**
 * Parser contribution for the shared `![[target|alias]]` media envelope.
 * Classification lives in the media grammar; image and video features retain
 * separate semantic models, plans, and widget lifecycles.
 */
export const markdownMediaParserExtension: MarkdownConfig = {
  defineNodes: [
    { name: "ObsidianImageEmbed", style: { "ObsidianImageEmbed/...": tags.link } },
    { name: "ObsidianImageMark", style: tags.processingInstruction },
    { name: "ObsidianImageTarget", style: tags.url },
    { name: "ObsidianImageAlias", style: tags.labelName },
    { name: "ObsidianVideoEmbed", style: { "ObsidianVideoEmbed/...": tags.link } },
    { name: "ObsidianVideoMark", style: tags.processingInstruction },
    { name: "ObsidianVideoTarget", style: tags.url },
    { name: "ObsidianVideoAlias", style: tags.labelName },
  ],
  parseInline: [
    {
      name: "ObsidianMediaEmbed",
      before: "Image",
      parse(context, next, position) {
        if (next !== 33 /* ! */) return -1;
        return parseObsidianMediaEmbed(context, position);
      },
    },
  ],
};

function parseObsidianMediaEmbed(context: InlineContext, position: number): number {
  const from = position - context.offset;
  const scan = scanObsidianMediaEmbedAt(context.text, from);
  if (!scan.token) return -1;

  const kind = scan.token.kind === "image" ? "Image" : "Video";
  return addObsidianMediaElement(context, scan.token.from, scan.token.to, kind);
}

function addObsidianMediaElement(
  context: InlineContext,
  from: number,
  to: number,
  kind: "Image" | "Video",
): number {
  const absoluteFrom = from + context.offset;
  const absoluteTo = to + context.offset;
  const contentFrom = absoluteFrom + 3;
  const contentTo = absoluteTo - 2;
  const pipeOffset = findUnescapedPipe(context.text, from + 3, to - 2);
  const children = [
    context.elt(`Obsidian${kind}Mark`, absoluteFrom, contentFrom),
    context.elt(
      `Obsidian${kind}Target`,
      contentFrom,
      pipeOffset === -1 ? contentTo : pipeOffset + context.offset,
    ),
  ];

  if (pipeOffset !== -1) {
    children.push(
      context.elt(`Obsidian${kind}Mark`, pipeOffset + context.offset, pipeOffset + context.offset + 1),
      context.elt(`Obsidian${kind}Alias`, pipeOffset + context.offset + 1, contentTo),
    );
  }

  children.push(context.elt(`Obsidian${kind}Mark`, contentTo, absoluteTo));
  return context.addElement(
    context.elt(`Obsidian${kind}Embed`, absoluteFrom, absoluteTo, children),
  );
}

function findUnescapedPipe(source: string, from: number, to: number): number {
  let escaped = false;
  for (let index = from; index < to; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "|") return index;
  }
  return -1;
}
