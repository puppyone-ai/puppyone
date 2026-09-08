import {
  advanceOpenMarkdownFence,
  findOpenMarkdownFence,
} from "../../domain/agent-stream-presentation";

export const AGENT_MARKDOWN_INITIAL_TEXT_LIMIT = 24 * 1024;
export const AGENT_MARKDOWN_INITIAL_BLOCK_LIMIT = 240;
export const AGENT_MARKDOWN_CODE_BLOCK_LIMIT = 128 * 1024;

const SAFE_EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);
const SAFE_FRAGMENT = /^#[A-Za-z][\w:.-]*$/;

export function classifyAgentMarkdownHref(value: string):
  | Readonly<{ kind: "fragment"; href: string }>
  | Readonly<{ kind: "external"; href: string }>
  | null {
  if (SAFE_FRAGMENT.test(value)) return { kind: "fragment", href: value };
  try {
    const url = new URL(value);
    if (!SAFE_EXTERNAL_PROTOCOLS.has(url.protocol)) return null;
    if ((url.protocol === "http:" || url.protocol === "https:") && (!url.hostname || url.username || url.password)) {
      return null;
    }
    if (url.protocol === "mailto:" && !url.pathname) return null;
    return { kind: "external", href: url.href };
  } catch {
    return null;
  }
}

export function transformAgentMarkdownUrl(value: string, key: string) {
  // Assistant-authored images never receive a network-loading capability.
  // Their alt text is rendered by the image presentation component instead.
  if (key === "src" || key === "srcSet") return null;
  return classifyAgentMarkdownHref(value)?.href ?? null;
}

export function createInitialAgentMarkdownWindow(text: string) {
  const source = normalizeLineEndings(text);
  const textWindow = source.length <= AGENT_MARKDOWN_INITIAL_TEXT_LIMIT
    ? source
    : createHeadTailWindow(source, AGENT_MARKDOWN_INITIAL_TEXT_LIMIT);
  const blockWindow = limitMarkdownBlocks(textWindow, AGENT_MARKDOWN_INITIAL_BLOCK_LIMIT);
  return Object.freeze({
    source: blockWindow.source,
    truncated: source.length > AGENT_MARKDOWN_INITIAL_TEXT_LIMIT || blockWindow.truncated,
  });
}

function createHeadTailWindow(source: string, limit: number) {
  const marker = "\n\n… long response collapsed …\n\n";
  const available = Math.max(0, limit - marker.length);
  const requestedHead = Math.floor(available * 0.75);
  const requestedTail = available - requestedHead;
  const headEnd = nextLineBoundary(source, requestedHead);
  const tailStart = previousLineBoundary(source, source.length - requestedTail);
  return `${closeOpenFence(source.slice(0, headEnd))}${marker}${openTailFence(source, tailStart)}${source.slice(tailStart)}`;
}

function nextLineBoundary(source: string, offset: number) {
  const newline = source.indexOf("\n", Math.max(0, offset));
  return newline < 0 ? source.length : newline + 1;
}

function previousLineBoundary(source: string, offset: number) {
  const newline = source.lastIndexOf("\n", Math.max(0, offset));
  return newline < 0 ? 0 : newline + 1;
}

function closeOpenFence(source: string) {
  const open = findOpenMarkdownFence(source);
  return open ? `${source}\n${open.marker.repeat(open.length)}` : source;
}

function openTailFence(source: string, tailStart: number) {
  const open = findOpenMarkdownFence(source.slice(0, tailStart));
  return open ? `${open.marker.repeat(open.length)}${open.info}\n` : "";
}

function limitMarkdownBlocks(source: string, limit: number) {
  const lines = source.split("\n");
  let blocks = 0;
  let inFence: ReturnType<typeof findOpenMarkdownFence> = null;
  let previousBlank = true;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextFence = advanceOpenMarkdownFence(inFence, line);
    if (nextFence !== inFence) {
      if (!inFence && previousBlank) blocks += 1;
      inFence = nextFence;
    } else if (!inFence && line.trim()) {
      if (previousBlank || /^#{1,6}\s|^\s*(?:>|[-*+] |\d+[.)] )/.test(line)) blocks += 1;
    }
    // The disclosure marker is itself one paragraph, so reserve the final
    // initial block slot for that truthful boundary.
    if (blocks >= limit) {
      return { source: `${lines.slice(0, index).join("\n")}\n\n… additional blocks collapsed …`, truncated: true };
    }
    previousBlank = !line.trim();
  }
  return { source, truncated: false };
}

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

export const agentMarkdownLimits = Object.freeze({
  maxInitialText: AGENT_MARKDOWN_INITIAL_TEXT_LIMIT,
  maxInitialBlocks: AGENT_MARKDOWN_INITIAL_BLOCK_LIMIT,
  maxCodeBlockText: AGENT_MARKDOWN_CODE_BLOCK_LIMIT,
});
