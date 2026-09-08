const TARGET_CATCH_UP_FRAMES = 6;

/**
 * Advances a presentation snapshot without mutating the authoritative text.
 * The adaptive step bounds visual lag even when a provider delivers a burst.
 */
export function nextAgentStreamText(displayed: string, authoritative: string) {
  if (!authoritative.startsWith(displayed)) return authoritative;
  if (displayed.length === authoritative.length) return displayed;
  const pending = splitGraphemes(authoritative.slice(displayed.length));
  const count = Math.max(1, Math.ceil(pending.length / TARGET_CATCH_UP_FRAMES));
  return displayed + pending.slice(0, count).join("");
}

/**
 * Keeps incomplete Markdown in a plain-text tail so syntax completion cannot
 * remount the live line. A validated GFM table is the one exception: once its
 * header contract is complete, newline-terminated body rows become stable one
 * at a time while the unfinished row remains in the tail.
 */
export function splitStreamingMarkdown(text: string) {
  const normalized = text.replace(/\r\n?/g, "\n");
  let openFence: OpenMarkdownFence | null = null;
  let safeBoundary = 0;
  let cursor = 0;
  let tableHeaderColumns: number | null = null;
  let inTable = false;

  for (const line of normalized.match(/.*(?:\n|$)/g) ?? []) {
    if (!line) continue;
    const lineStart = cursor;
    cursor += line.length;
    const terminated = line.endsWith("\n");
    const content = terminated ? line.slice(0, -1) : line;
    const nextFence = advanceOpenMarkdownFence(openFence, content);
    if (nextFence !== openFence) {
      openFence = nextFence;
      tableHeaderColumns = null;
      inTable = false;
      if (!openFence) safeBoundary = cursor;
      continue;
    }
    if (openFence) continue;

    if (inTable) {
      if (content.trim() === "") {
        safeBoundary = cursor;
        inTable = false;
        tableHeaderColumns = null;
        continue;
      }
      // GFM pads pipe-less body rows with empty cells, so a structural pipe is
      // not required here. Stop only when CommonMark starts a competing flow
      // block; otherwise every newline-complete row can safely join the table.
      if (terminated && !interruptsGfmTable(content)) {
        safeBoundary = cursor;
        continue;
      }
      inTable = false;
      tableHeaderColumns = null;
    }

    if (content.trim() === "") {
      safeBoundary = cursor;
      tableHeaderColumns = null;
      continue;
    }

    if (tableHeaderColumns !== null) {
      if (terminated && isGfmTableDelimiter(content, tableHeaderColumns)) {
        safeBoundary = cursor;
        inTable = true;
      }
      tableHeaderColumns = null;
      continue;
    }

    // The candidate must begin at the current stable boundary. This prevents
    // a pipe in an unfinished prose paragraph from promoting that paragraph.
    if (terminated && lineStart === safeBoundary) {
      tableHeaderColumns = gfmTableHeaderColumnCount(content);
    }
  }

  return {
    stable: normalized.slice(0, safeBoundary),
    tail: normalized.slice(safeBoundary),
  };
}

function gfmTableHeaderColumnCount(line: string) {
  const cells = splitGfmTableCells(line);
  return cells && cells.length >= 1 ? cells.length : null;
}

function isGfmTableDelimiter(line: string, headerColumns: number) {
  const cells = splitGfmTableCells(line);
  return Boolean(
    cells
    && cells.length === headerColumns
    && cells.every((cell) => /^:?-+:?$/.test(cell.trim())),
  );
}

const GFM_TABLE_HTML_BLOCK_TAGS = [
  "address", "article", "aside", "base", "basefont", "blockquote", "body",
  "caption", "center", "col", "colgroup", "dd", "details", "dialog", "dir",
  "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form",
  "frame", "frameset", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header",
  "hr", "html", "iframe", "legend", "li", "link", "main", "menu", "menuitem",
  "nav", "noframes", "ol", "optgroup", "option", "p", "param", "search",
  "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead",
  "title", "tr", "track", "ul",
].join("|");

const GFM_TABLE_HTML_BLOCK = new RegExp(
  `^\\s{0,3}(?:<!--|<\\?|<![A-Z]|<!\\[CDATA\\[|<\\/?(?:${GFM_TABLE_HTML_BLOCK_TAGS})(?:\\s|/?>|$))`,
  "i",
);

/** Flow blocks end a GFM table instead of becoming padded body rows. */
function interruptsGfmTable(line: string) {
  return /^(?: {4}|\t)/.test(line)
    || /^\s{0,3}#{1,6}(?:[ \t]+|$)/.test(line)
    || /^\s{0,3}>/.test(line)
    || /^\s{0,3}(?:[-+*](?:[ \t]+|$)|\d{1,9}[.)](?:[ \t]+|$))/.test(line)
    || /^\s{0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line)
    || GFM_TABLE_HTML_BLOCK.test(line);
}

/** Splits only structural pipes, leaving escaped pipes and inline code intact. */
function splitGfmTableCells(line: string) {
  const source = line.trim();
  const cells: string[] = [];
  let cell = "";
  let separators = 0;
  let codeTicks = 0;
  let lastWasSeparator = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\" && index + 1 < source.length) {
      cell += character + source[index + 1];
      lastWasSeparator = false;
      index += 1;
      continue;
    }
    if (character === "`") {
      let run = 1;
      while (source[index + run] === "`") run += 1;
      const ticks = "`".repeat(run);
      cell += ticks;
      if (codeTicks === 0) codeTicks = run;
      else if (codeTicks === run) codeTicks = 0;
      lastWasSeparator = false;
      index += run - 1;
      continue;
    }
    if (character === "|" && codeTicks === 0) {
      cells.push(cell);
      cell = "";
      separators += 1;
      lastWasSeparator = true;
      continue;
    }
    cell += character;
    lastWasSeparator = false;
  }

  if (separators === 0) return null;
  cells.push(cell);
  if (source.startsWith("|")) cells.shift();
  if (lastWasSeparator) cells.pop();
  return cells;
}

export type OpenMarkdownFence = Readonly<{
  marker: "`" | "~";
  length: number;
  info: string;
}>;

/** CommonMark fence scanner shared by streaming and bounded head/tail windows. */
export function findOpenMarkdownFence(source: string): OpenMarkdownFence | null {
  let openFence: OpenMarkdownFence | null = null;
  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    openFence = advanceOpenMarkdownFence(openFence, line);
  }
  return openFence;
}

export function advanceOpenMarkdownFence(openFence: OpenMarkdownFence | null, line: string) {
  const match = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return openFence;
  const marker = match[1][0] as "`" | "~";
  const remainder = match[2];
  if (!openFence) {
    if (marker === "`" && remainder.includes("`")) return openFence;
    return { marker, length: match[1].length, info: remainder.trim() } satisfies OpenMarkdownFence;
  }
  if (openFence.marker !== marker || match[1].length < openFence.length || remainder.trim()) return openFence;
  return null;
}

function splitGraphemes(value: string) {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(value), (entry) => entry.segment);
  }
  return Array.from(value);
}
