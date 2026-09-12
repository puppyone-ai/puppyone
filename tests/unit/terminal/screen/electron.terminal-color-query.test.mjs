import { describe, expect, it } from "vitest";
import { createTerminalDefaultColorResponder } from "../../../../electron/main/terminal-service.mjs";

const colors = {
  foreground: [109, 102, 93],
  background: [251, 250, 247],
};

describe("terminal default-color query responder", () => {
  it("answers and removes OSC 10/11 probes before xterm rendering", () => {
    const responder = createTerminalDefaultColorResponder(colors);

    expect(responder.process(
      "before\u001b]10;?\u001b\\middle\u001b]11;?\u0007after",
    )).toEqual({
      data: "beforemiddleafter",
      replies: [
        "\u001b]10;rgb:6d6d/6666/5d5d\u001b\\",
        "\u001b]11;rgb:fbfb/fafa/f7f7\u001b\\",
      ],
    });
  });

  it("recognizes a color query split across PTY output chunks", () => {
    const responder = createTerminalDefaultColorResponder(colors);

    expect(responder.process("prompt\u001b]11;?")).toEqual({
      data: "prompt",
      replies: [],
    });
    expect(responder.process("\u001b\\rest")).toEqual({
      data: "rest",
      replies: ["\u001b]11;rgb:fbfb/fafa/f7f7\u001b\\"],
    });
    expect(responder.flush()).toBe("");
  });

  it("keeps the normal xterm path when renderer colors are invalid", () => {
    expect(createTerminalDefaultColorResponder({
      foreground: [109, 102, 999],
      background: [251, 250, 247],
    })).toBeNull();
  });

  it("answers later probes with the current renderer theme", () => {
    const responder = createTerminalDefaultColorResponder(colors);

    expect(responder.updateColors({
      foreground: [209, 206, 198],
      background: [22, 20, 19],
    })).toBe(true);
    expect(responder.process("\u001b]10;?\u001b\\\u001b]11;?\u001b\\")).toEqual({
      data: "",
      replies: [
        "\u001b]10;rgb:d1d1/cece/c6c6\u001b\\",
        "\u001b]11;rgb:1616/1414/1313\u001b\\",
      ],
    });
  });
});
