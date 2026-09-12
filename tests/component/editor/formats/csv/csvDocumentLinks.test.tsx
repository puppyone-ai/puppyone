/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocumentNavigationPort } from "../../../../../packages/shared-ui/src/editor/navigation/documentNavigation";
import { CsvTableEditor } from "../../../../../packages/shared-ui/src/editor/viewers/csv/CsvTableEditor";
import { writeCsvFirstRecordAsHeaderPreference } from "../../../../../packages/shared-ui/src/editor/viewers/csv/csvViewPreferences";
import { withTestLocalization } from "../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  window.localStorage.clear();
  writeCsvFirstRecordAsHeaderPreference("links.csv", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container = null;
  document.body.replaceChildren();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("CSV document links", () => {
  it("projects labels without replacing editable source and opens explicit actions", async () => {
    const openExternalUrl = vi.fn();
    const openWorkspaceCandidates = vi.fn();
    const navigation = createDocumentNavigationPort({
      resolveWorkspaceReference(_sourcePath, target) {
        return target === "Spec"
          ? {
              exists: true,
              ambiguous: false,
              path: "notes/spec.md",
              candidatePaths: ["notes/spec.md"],
            }
          : { exists: false, ambiguous: false, path: null };
      },
      openExternalUrl,
      openWorkspaceCandidates,
    });

    await act(async () => {
      root?.render(withTestLocalization(
        <CsvTableEditor
          content={[
            "Kind,Value",
            "Web,[Docs](https://example.com/docs)",
            "Note,[[Spec|Design spec]]",
            "Text,ordinary value",
          ].join("\n")}
          documentId="links.csv"
          documentNavigation={navigation}
          nodeName="links.csv"
          readOnly={false}
        />,
      ));
      await Promise.resolve();
    });

    const externalCell = getBodyCell(1, 1);
    const workspaceCell = getBodyCell(2, 1);
    const plainCell = getBodyCell(3, 1);
    const externalInput = externalCell.querySelector<HTMLInputElement>("input");
    const externalAction = externalCell.querySelector<HTMLButtonElement>(
      ".csv-table-editor__reference-action",
    );
    const workspaceAction = workspaceCell.querySelector<HTMLButtonElement>(
      ".csv-table-editor__reference-action",
    );
    if (!externalInput || !externalAction || !workspaceAction) {
      throw new Error("CSV reference controls did not mount.");
    }

    expect(externalInput.value).toBe("[Docs](https://example.com/docs)");
    expect(externalCell.querySelector(".csv-table-editor__reference-label")?.textContent).toBe("Docs");
    expect(externalCell.querySelector(".csv-table-editor__reference-source")?.textContent)
      .toBe("[Docs](https://example.com/docs)");
    expect(workspaceCell.querySelector(".csv-table-editor__reference-label")?.textContent)
      .toBe("Design spec");
    expect(plainCell.querySelector(".csv-table-editor__reference-action")).toBeNull();

    await act(async () => {
      externalAction.click();
      workspaceAction.click();
      await Promise.resolve();
    });
    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/docs");
    expect(openWorkspaceCandidates).toHaveBeenCalledWith(["notes/spec.md"]);

    await act(async () => {
      externalInput.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
      }));
      await Promise.resolve();
    });
    expect(openExternalUrl).toHaveBeenCalledTimes(2);

    await act(async () => {
      externalInput.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "Enter",
      }));
      await Promise.resolve();
    });
    expect(openExternalUrl).toHaveBeenCalledTimes(3);

    await act(async () => {
      setInputValue(externalInput, "ordinary value");
      externalInput.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    expect(externalInput.value).toBe("ordinary value");
    expect(externalCell.querySelector(".csv-table-editor__reference-label")).toBeNull();
    expect(externalCell.querySelector(".csv-table-editor__reference-action")).toBeNull();
  });

  it("keeps missing workspace links visible but non-navigable", async () => {
    const openWorkspaceCandidates = vi.fn();
    const navigation = createDocumentNavigationPort({
      resolveWorkspaceReference() {
        return { exists: false, ambiguous: false, path: null };
      },
      openWorkspaceCandidates,
    });

    await act(async () => {
      root?.render(withTestLocalization(
        <CsvTableEditor
          content={"Kind,Value\nNote,[[Missing|Missing note]]"}
          documentId="links.csv"
          documentNavigation={navigation}
          nodeName="links.csv"
          readOnly={false}
        />,
      ));
      await Promise.resolve();
    });

    const cell = getBodyCell(1, 1);
    const action = cell.querySelector<HTMLButtonElement>(".csv-table-editor__reference-action");
    expect(cell.getAttribute("data-reference-status")).toBeNull();
    expect(cell.querySelector("[data-reference-status='missing']")).not.toBeNull();
    expect(action?.disabled).toBe(true);
    act(() => action?.click());
    expect(openWorkspaceCandidates).not.toHaveBeenCalled();
  });
});

function getBodyCell(row: number, column: number): HTMLTableCellElement {
  const cell = container?.querySelector<HTMLTableCellElement>(
    `tbody td[data-csv-row='${row}'][data-csv-column='${column}']`,
  );
  if (!cell) throw new Error(`CSV cell ${row}:${column} did not mount.`);
  return cell;
}

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
}
