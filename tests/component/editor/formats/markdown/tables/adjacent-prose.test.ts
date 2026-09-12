/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";

import { getMarkdownPlanIndex } from "../../../../../../packages/shared-ui/src/editor/markdown/core/plans/markdownPlanIndex";
import { TABLE_SOURCE, createTableView, source } from "../../../../../support/editor/markdown/tableInteractions";

describe("Markdown table EditorView interactions", () => {

  it("renders adjacent prose as editor text instead of synthetic table rows", () => {
    const prose = "这里面有几个要素值得注意。";
    const view = createTableView(`${TABLE_SOURCE}\n${prose}`);
    const wrapper = view.dom.querySelector<HTMLElement>(".cm-md-table-widget-wrap")!;
    const rows = wrapper.querySelectorAll("tr[data-md-table-row]");

    expect(rows).toHaveLength(3);
    expect(wrapper.textContent).not.toContain(prose);
    expect(Array.from(view.dom.querySelectorAll(".cm-line")).some((line) => (
      line.textContent?.includes(prose)
    ))).toBe(true);

    wrapper.querySelector<HTMLButtonElement>(".cm-md-table-add-row")?.click();
    expect(source(view)).toContain(`\n${prose}`);
    expect(source(view).split("\n").filter((line) => line === prose)).toHaveLength(1);
  });

  it("keeps prose typed directly after a table in the normal editor surface", () => {
    const view = createTableView(`${TABLE_SOURCE}\n`);
    const prose = "正文会留在表格外。";
    expect(view.dom.querySelector(".cm-md-table-widget-wrap")).not.toBeNull();

    for (const character of prose) {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: character },
        selection: { anchor: view.state.doc.length + character.length },
        userEvent: "input.type",
      });
      const tablePlan = getMarkdownPlanIndex(view.state).find(({ plan }) => (
        plan.presentation === "blockAtom" && plan.embed.kind === "table"
      ));
      expect(tablePlan?.plan.sourceRange, `table plan after typing ${character}`).toEqual({
        from: 0,
        to: TABLE_SOURCE.length,
      });
      expect(
        view.dom.querySelector(".cm-md-table-widget-wrap"),
        `table widget after typing ${character}`,
      ).not.toBeNull();
    }

    const wrapper = view.dom.querySelector<HTMLElement>(".cm-md-table-widget-wrap")!;
    expect(wrapper.querySelectorAll("tr[data-md-table-row]")).toHaveLength(3);
    expect(wrapper.textContent).not.toContain(prose);
    expect(source(view)).toBe(`${TABLE_SOURCE}\n${prose}`);
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    expect(Array.from(view.dom.querySelectorAll(".cm-line")).some((line) => (
      line.textContent?.includes(prose)
    ))).toBe(true);
  });
});
