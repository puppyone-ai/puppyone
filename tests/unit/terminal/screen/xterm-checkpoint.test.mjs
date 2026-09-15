import { describe, expect, it } from "vitest";
import headless from "@xterm/headless";
import serialize from "@xterm/addon-serialize";
import { canCheckpointXterm, captureXtermCheckpoint, restoreXtermCheckpoint } from "../../../../shared/terminal-contract/xterm-checkpoint.mjs";

const write = (terminal, data) => new Promise((resolve) => terminal.write(data, resolve));
const create = () => new headless.Terminal({ cols: 30, rows: 8, scrollback: 100, allowProposedApi: true, convertEol: true });
function screen(terminal) {
  const buffer = terminal.buffer.active;
  return { type: buffer.type, cursor: [buffer.cursorX, buffer.cursorY],
    rows: Array.from({ length: buffer.length }, (_, y) => {
      const line = buffer.getLine(y);
      return Array.from({ length: line.length }, (_, x) => {
        const cell = line.getCell(x);
        return [cell.getChars(), cell.getFgColor(), cell.getBgColor(), cell.isBold(), cell.isUnderline()];
      });
    }) };
}

describe("pinned xterm checkpoint continuation", () => {
  it.each([
    ["scroll regions and origin mode", "\x1b[3;6r\x1b[?6h\x1b[2;1Hfirst", "\x1b[4;1Hlast\nscroll\nnext"],
    ["custom tab stops", "\x1b[3gabc\x1bHdefgh\x1bH", "\r\tA\tB"],
    ["saved cursor and rendition", "\x1b[3;8H\x1b[32;1m\x1b7\x1b[1;1H\x1b[31mX", "\x1b8green"],
    ["line drawing charset", "\x1b(0lqqk", "\r\nx  x\r\nmqqj\x1b(Btext"],
    ["alternate screen returning to the normal buffer", "normal\x1b[?1049h\x1b[2;4Halternate", "\x1b[?1049l\nnext"],
    ["alternate screen custom region", "normal\x1b[?1049h\x1b[2;5r\x1b[5;1Hbottom", "\nscroll\nagain"],
  ])("preserves %s", async (_name, prefix, suffix) => {
    const original = create();
    const restored = create();
    const addon = new serialize.SerializeAddon();
    original.loadAddon(addon);
    try {
      await write(original, prefix);
      expect(canCheckpointXterm(original)).toBe(true);
      const state = captureXtermCheckpoint(original);
      await write(restored, addon.serialize());
      restoreXtermCheckpoint(restored, state);
      await write(original, suffix);
      await write(restored, suffix);
      expect(screen(restored)).toEqual(screen(original));
    } finally { original.dispose(); restored.dispose(); }
  });

  it("does not discard an unfinished escape or UTF-16 surrogate at a checkpoint", async () => {
    const terminal = create();
    try {
      await write(terminal, "\ud83d");
      expect(canCheckpointXterm(terminal)).toBe(false);
      await write(terminal, "\ude80");
      expect(canCheckpointXterm(terminal)).toBe(true);
      await write(terminal, "\x1b[31");
      expect(canCheckpointXterm(terminal)).toBe(false);
      await write(terminal, "mred");
      expect(canCheckpointXterm(terminal)).toBe(true);
    } finally { terminal.dispose(); }
  });
});
