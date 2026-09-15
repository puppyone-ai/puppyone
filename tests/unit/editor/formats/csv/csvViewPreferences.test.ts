import { describe, expect, it } from "vitest";
import {
  readCsvFirstRecordAsHeaderPreference,
  readCsvColumnWidthsPreference,
  readCsvShowRowNumbersPreference,
  writeCsvColumnWidthsPreference,
  writeCsvFirstRecordAsHeaderPreference,
  writeCsvShowRowNumbersPreference,
} from "../../../../../packages/shared-ui/src/editor/viewers/csv/csvViewPreferences";

describe("CSV view preferences", () => {
  it("keeps header interpretation per document without touching CSV content", () => {
    const storage = createMemoryStorage();

    expect(readCsvFirstRecordAsHeaderPreference("/vault/one.csv", storage)).toBeUndefined();
    writeCsvFirstRecordAsHeaderPreference("/vault/one.csv", true, storage);
    writeCsvFirstRecordAsHeaderPreference("/vault/two.csv", false, storage);

    expect(readCsvFirstRecordAsHeaderPreference("/vault/one.csv", storage)).toBe(true);
    expect(readCsvFirstRecordAsHeaderPreference("/vault/two.csv", storage)).toBe(false);
  });

  it("keeps row-number visibility per document and preserves sibling preferences", () => {
    const storage = createMemoryStorage();

    writeCsvFirstRecordAsHeaderPreference("/vault/one.csv", true, storage);
    writeCsvShowRowNumbersPreference("/vault/one.csv", false, storage);
    writeCsvShowRowNumbersPreference("/vault/two.csv", true, storage);

    expect(readCsvFirstRecordAsHeaderPreference("/vault/one.csv", storage)).toBe(true);
    expect(readCsvShowRowNumbersPreference("/vault/one.csv", storage)).toBe(false);
    expect(readCsvShowRowNumbersPreference("/vault/two.csv", storage)).toBe(true);
    expect(readCsvFirstRecordAsHeaderPreference("/vault/two.csv", storage)).toBeUndefined();

    writeCsvFirstRecordAsHeaderPreference("/vault/one.csv", false, storage);
    expect(readCsvShowRowNumbersPreference("/vault/one.csv", storage)).toBe(false);
  });

  it("fails open when preference storage is missing or malformed", () => {
    const storage = createMemoryStorage("not-json");

    expect(readCsvFirstRecordAsHeaderPreference("/vault/table.csv", storage)).toBeUndefined();
    expect(readCsvShowRowNumbersPreference("/vault/table.csv", storage)).toBeUndefined();
    expect(() => writeCsvFirstRecordAsHeaderPreference(undefined, true, storage)).not.toThrow();
    expect(() => writeCsvFirstRecordAsHeaderPreference("/vault/table.csv", true, {
      getItem: () => null,
      setItem: () => {
        throw new Error("storage unavailable");
      },
    })).not.toThrow();
  });

  it("stores compatible column geometry as view state beside other preferences", () => {
    const storage = createMemoryStorage();

    writeCsvFirstRecordAsHeaderPreference("/vault/table.csv", true, storage);
    writeCsvColumnWidthsPreference("/vault/table.csv", ",", [144, 260], storage);

    expect(readCsvColumnWidthsPreference("/vault/table.csv", ",", 2, storage))
      .toEqual([144, 260]);
    expect(readCsvColumnWidthsPreference("/vault/table.csv", "\t", 2, storage))
      .toBeUndefined();
    expect(readCsvColumnWidthsPreference("/vault/table.csv", ",", 3, storage))
      .toBeUndefined();
    expect(readCsvFirstRecordAsHeaderPreference("/vault/table.csv", storage)).toBe(true);
  });
});

function createMemoryStorage(initialValue?: string) {
  const values = new Map<string, string>();
  if (initialValue !== undefined) values.set("puppyone.editor.csv-view-preferences.v1", initialValue);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}
