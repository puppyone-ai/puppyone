import { describe, expect, it } from "vitest";
import { CsvDocumentModel } from "../../../../../packages/shared-ui/src/editor/viewers/csv/CsvDocumentModel";

describe("CSV structured document model", () => {
  it("updates only the target row and serializes only at an explicit snapshot boundary", () => {
    const source = "Name,Score\nAda,1\nLin,2";
    const model = new CsvDocumentModel("people.csv", source, ",");
    const initial = model.getSnapshot();
    const untouchedHeader = initial.rows[0];
    const targetRow = initial.rows[1];
    const untouchedRow = initial.rows[2];

    const transaction = model.setCell(1, 1, "10");
    const edited = model.getSnapshot();

    expect(transaction.changed).toBe(true);
    expect(edited.revision).not.toBe(initial.revision);
    expect(edited.rows).not.toBe(initial.rows);
    expect(edited.rows[0]).toBe(untouchedHeader);
    expect(edited.rows[1]).not.toBe(targetRow);
    expect(edited.rows[2]).toBe(untouchedRow);
    expect(edited.rows[1].cells).toEqual(["Ada", "10"]);
    expect(model.readSnapshot()).toEqual({
      content: "Name,Score\nAda,10\nLin,2",
      revision: edited.revision,
    });
    expect(model.readSnapshot()).toBe(model.readSnapshot());
  });

  it("preserves exact accepted source until a local transaction requires canonical serialization", () => {
    const source = '\uFEFFname,notes\r\nAda,"hello"\r\n';
    const model = new CsvDocumentModel("layout.csv", source, ",");

    expect(model.readSnapshot().content).toBe(source);
    model.setCell(1, 1, "updated");
    expect(model.readSnapshot().content).toBe("\uFEFFname,notes\r\nAda,updated\r\n");

    const external = 'name,notes\nGrace,"quoted"';
    const replacement = model.replaceContent(external);
    expect(replacement.content).toBe(external);
    expect(model.readSnapshot()).toBe(replacement);
  });

  it("keeps stable row and column identities across edits and structural moves", () => {
    const model = new CsvDocumentModel("identity.csv", "Name,Score\nAda,1\nLin,2", ",");
    const initial = model.getSnapshot();
    const adaId = initial.rows[1].id;
    const linId = initial.rows[2].id;
    const nameColumnId = initial.columns[0].id;
    const scoreColumnId = initial.columns[1].id;

    model.applyStructureOperation(true, {
      type: "move-row-down",
      rowIndex: 1,
      columnIndex: 0,
    });
    const movedRow = model.getSnapshot();
    expect(movedRow.rows[1].id).toBe(linId);
    expect(movedRow.rows[2].id).toBe(adaId);

    model.applyStructureOperation(true, {
      type: "move-column-right",
      rowIndex: 1,
      columnIndex: 0,
    });
    const movedColumn = model.getSnapshot();
    expect(movedColumn.columns[0].id).toBe(scoreColumnId);
    expect(movedColumn.columns[1].id).toBe(nameColumnId);
  });

  it("provides model-owned undo and redo without relying on mounted input history", () => {
    const model = new CsvDocumentModel("history.csv", "Name,Score\nAda,1", ",");
    model.setCell(1, 1, "2");
    expect(model.readSnapshot().content).toBe("Name,Score\nAda,2");

    expect(model.undo().changed).toBe(true);
    expect(model.readSnapshot().content).toBe("Name,Score\nAda,1");
    expect(model.redo().changed).toBe(true);
    expect(model.readSnapshot().content).toBe("Name,Score\nAda,2");
  });

  it("keeps a 500 by 20 character edit local to one row", () => {
    const source = makeCsv(500, 20);
    const model = new CsvDocumentModel("large.csv", source, ",");
    const before = model.getSnapshot();
    const stableRows = before.rows.filter((_, index) => index !== 250);

    model.setCell(250, 10, "updated");
    const after = model.getSnapshot();

    expect(after.rows[250]).not.toBe(before.rows[250]);
    expect(stableRows.every((row) => after.rows.includes(row))).toBe(true);
    expect(after.rows[250].cells[10]).toBe("updated");
  });
});

function makeCsv(rowCount: number, columnCount: number): string {
  return Array.from({ length: rowCount }, (_, rowIndex) => (
    Array.from({ length: columnCount }, (_, columnIndex) => `r${rowIndex}c${columnIndex}`).join(",")
  )).join("\n");
}
