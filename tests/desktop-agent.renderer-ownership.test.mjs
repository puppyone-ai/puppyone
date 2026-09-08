import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const ui = "src/features/desktop-agent/ui/";
const eslint = new ESLint({ cwd: root });
async function violations(source, file = `${ui}AgentMessagePart.tsx`) {
  const [result] = await eslint.lintText(source, { filePath: file });
  return result.messages.filter(message => message.severity === 2);
}

describe("Chat viewport ownership gate", () => {
  it.each([
    "element.scrollTop = 10;",
    "element['scrollTop'] += 10;",
    "element.scrollTop++;",
    "element.scrollTo({top: 10});",
    "element['scrollBy'](0, 10);",
    "element?.scrollIntoView();",
    "element.scroll({top: 10});",
    "new ResizeObserver(callback);",
    "new window.ResizeObserver(callback);",
  ])("rejects an independent scroll/measurement owner: %s", async source => {
    expect(await violations(source)).toEqual([expect.objectContaining({ ruleId: "no-restricted-syntax" })]);
  });

  it("allows read-only geometry and reporting to the shared owner", async () => {
    expect(await violations("const top = element.scrollTop; onViewportChange(top); onMeasureElement(id, element);")).toEqual([]);
  });

  it.each(["transcript/useTranscriptViewport.ts", "AgentRenderStabilitySmokeHarness.tsx"])(
    "allows the explicit owner or isolated fixture: %s", async file => {
      expect(await violations("element.scrollTop = 10; new ResizeObserver(callback);", `${ui}${file}`)).toEqual([]);
    },
  );

  it("applies to newly added TS hooks and TSX leaves", async () => {
    for (const file of ["transcript/useAnotherViewport.ts", "activity/NewActivity.tsx", "composer/NewComposer.tsx"]) {
      expect(await violations("element.scrollTop = 10;", `${ui}${file}`)).toHaveLength(1);
    }
  });
});
