import { EditorState, RangeSet } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdownCodeMirrorBaseExtensions, markdownLivePreviewExtension } from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";
import { markdownLivePreviewDecorations, requestMarkdownProjectionRange } from "../../../../../../packages/shared-ui/src/editor/markdown/core/decorations/livePreviewDecorations";

import { getMarkdownMarkerDiagnostics, resetMarkdownMarkerDiagnostics } from "../../../../../../packages/shared-ui/src/editor/markdown/core/presentation/markdownBlockRhythm";

const create = (doc: string) => EditorState.create({ doc, extensions: [markdownCodeMirrorBaseExtensions(false), markdownLivePreviewExtension()] });
const projection = (state: EditorState) => state.field(markdownLivePreviewDecorations).decorations;

function lineAttributes(state: EditorState, number: number) {
  const line = state.doc.line(number), attributes: Record<string, string>[] = [];
  projection(state).between(line.from, line.from, (_from, _to, decoration) => {
    if (decoration.spec.class) attributes.push({ class: decoration.spec.class, style: decoration.spec.attributes?.style ?? "" });
  });
  return attributes;
}

describe("Markdown semantic block rhythm", () => {
  it("marks paragraph edges without separating soft source lines or decorating empty lines", () => {
    const state = create("First line\ncontinued paragraph\n\nSecond paragraph");
    expect(lineAttributes(state,1)).toEqual([expect.objectContaining({class:"cm-md-paragraph-start"})]);
    expect(lineAttributes(state,2)).toEqual([expect.objectContaining({class:"cm-md-paragraph-end"})]);
    expect(lineAttributes(state,3)).toEqual([]);
    expect(lineAttributes(state,4)[0].class.split(" ")).toEqual(expect.arrayContaining(["cm-md-paragraph-start","cm-md-paragraph-end"]));
  });

  it("resolves nesting from parsed ownership and keeps continuation lines in the same hanging column", () => {
    const state = create("- root\n  continued\n    - child\n      child continued\n- next");
    expect(lineAttributes(state,2)[0]).toMatchObject({class:expect.stringContaining("cm-md-list-continuation"), style:expect.stringContaining("--md-list-depth:0;")});
    // Four source spaces still represent one nested level, not two.
    expect(lineAttributes(state,3)[0].style).toContain("--md-list-depth:1;");
    expect(lineAttributes(state,4)[0].style).toContain("--md-list-depth:1;");
    expect(lineAttributes(state,5)[0].style).toContain("--md-list-depth:0;");
  });

  it("reserves one shared column for the widest ordered marker", () => {
    const state = create("9. nine\n10. ten\n100. hundred");
    for (let number=1;number<=3;number++) expect(lineAttributes(state,number)[0].style).toContain("--md-list-marker-columns:4;");
  });

  it("reuses ordered column geometry through ordinary body edits instead of scanning siblings", () => {
    let state=create(Array.from({length:100},(_,i)=>`${i+1}. Item ${i+1}`).join("\n"));
    const line=state.doc.line(50);
    resetMarkdownMarkerDiagnostics();
    state=state.update({changes:{from:line.to,to:line.to,insert:" revised"}}).state;
    expect(getMarkdownMarkerDiagnostics().itemsScanned).toBe(0);
    expect(lineAttributes(state,50)[0].style).toContain("--md-list-marker-columns:4;");
  });

  it.each([
    {doc:"First\nsecond\nthird\nfourth", from:12, to:12, insert:"\n", name:"split paragraph"},
    {doc:"First\n\nsecond\nthird", from:6, to:7, insert:"", name:"merge paragraphs"},
    {doc:"- root\n- child\n  - grandchild\n- last", from:7, to:7, insert:"  ", name:"reparent descendants"},
    {doc:"9. nine\n10. ten\n100. hundred", from:27, to:27, insert:"\n1000. appended", name:"append wider ordered item"},
    {doc:"9. nine\n10. ten\n100. hundred", from:15, to:18, insert:"1000", name:"resize shared ordered column"},
    {doc:"- first\n- last", from:0, to:0, insert:"- inserted\n", name:"insert first item"},
    {doc:"- first\n- last", from:0, to:8, insert:"", name:"remove first item"},
  ])("matches a fresh projection after $name", ({doc,from,to,insert}) => {
    let state=create(doc);
    state=state.update({changes:{from,to,insert}}).state;
    const incremental=projection(state);
    state=state.update({effects:requestMarkdownProjectionRange(state,0,state.doc.length)}).state;
    expect(RangeSet.eq([incremental],[projection(state)])).toBe(true);
  });
});
