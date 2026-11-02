const CSV_VIEW_PREFERENCES_STORAGE_KEY = "puppyone.editor.csv-view-preferences.v1";
const MAX_STORED_CSV_VIEW_PREFERENCES = 200;

type CsvViewPreferenceEntry = Readonly<{
  columnLayout?: CsvStoredColumnLayout;
  firstRecordAsHeader?: boolean;
  showRowNumbers?: boolean;
  updatedAt: number;
}>;

type CsvStoredColumnLayout = Readonly<{
  delimiter: "," | "\t";
  widths: readonly number[];
}>;

type CsvViewPreferenceStore = Record<string, CsvViewPreferenceEntry>;

type CsvViewPreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function readCsvFirstRecordAsHeaderPreference(
  documentId: string | undefined,
  storage: CsvViewPreferenceStorage | null = getBrowserStorage(),
): boolean | undefined {
  const key = normalizeDocumentId(documentId);
  if (!key || !storage) return undefined;
  return readPreferenceStore(storage)[key]?.firstRecordAsHeader;
}

export function writeCsvFirstRecordAsHeaderPreference(
  documentId: string | undefined,
  firstRecordAsHeader: boolean,
  storage: CsvViewPreferenceStorage | null = getBrowserStorage(),
) {
  writeCsvViewPreference(documentId, { firstRecordAsHeader }, storage);
}

export function readCsvShowRowNumbersPreference(
  documentId: string | undefined,
  storage: CsvViewPreferenceStorage | null = getBrowserStorage(),
): boolean | undefined {
  const key = normalizeDocumentId(documentId);
  if (!key || !storage) return undefined;
  return readPreferenceStore(storage)[key]?.showRowNumbers;
}

export function writeCsvShowRowNumbersPreference(
  documentId: string | undefined,
  showRowNumbers: boolean,
  storage: CsvViewPreferenceStorage | null = getBrowserStorage(),
) {
  writeCsvViewPreference(documentId, { showRowNumbers }, storage);
}

export function readCsvColumnWidthsPreference(
  documentId: string | undefined,
  delimiter: "," | "\t",
  columnCount: number,
  storage: CsvViewPreferenceStorage | null = getBrowserStorage(),
): readonly number[] | undefined {
  const key = normalizeDocumentId(documentId);
  if (!key || !storage) return undefined;
  const layout = readPreferenceStore(storage)[key]?.columnLayout;
  if (!layout || layout.delimiter !== delimiter || layout.widths.length !== columnCount) {
    return undefined;
  }
  return layout.widths;
}

export function writeCsvColumnWidthsPreference(
  documentId: string | undefined,
  delimiter: "," | "\t",
  widths: readonly number[],
  storage: CsvViewPreferenceStorage | null = getBrowserStorage(),
) {
  writeCsvViewPreference(documentId, {
    columnLayout: {
      delimiter,
      widths: [...widths],
    },
  }, storage);
}

function writeCsvViewPreference(
  documentId: string | undefined,
  patch: Pick<CsvViewPreferenceEntry, "columnLayout" | "firstRecordAsHeader" | "showRowNumbers">,
  storage: CsvViewPreferenceStorage | null,
) {
  const key = normalizeDocumentId(documentId);
  if (!key || !storage) return;

  const currentStore = readPreferenceStore(storage);
  const nextStore: CsvViewPreferenceStore = {
    ...currentStore,
    [key]: {
      ...currentStore[key],
      ...patch,
      updatedAt: Date.now(),
    },
  };
  const recentEntries = Object.entries(nextStore)
    .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
    .slice(0, MAX_STORED_CSV_VIEW_PREFERENCES);

  try {
    storage.setItem(CSV_VIEW_PREFERENCES_STORAGE_KEY, JSON.stringify(Object.fromEntries(recentEntries)));
  } catch {
    // View preferences are best-effort and must never block document editing.
  }
}

function readPreferenceStore(storage: CsvViewPreferenceStorage): CsvViewPreferenceStore {
  try {
    const raw = storage.getItem(CSV_VIEW_PREFERENCES_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const entries: CsvViewPreferenceStore = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const candidate = value as Partial<CsvViewPreferenceEntry>;
      const columnLayout = parseStoredColumnLayout(candidate.columnLayout);
      const firstRecordAsHeader = typeof candidate.firstRecordAsHeader === "boolean"
        ? candidate.firstRecordAsHeader
        : undefined;
      const showRowNumbers = typeof candidate.showRowNumbers === "boolean"
        ? candidate.showRowNumbers
        : undefined;
      if (
        columnLayout === undefined
        && firstRecordAsHeader === undefined
        && showRowNumbers === undefined
      ) continue;
      entries[key] = {
        ...(columnLayout === undefined ? {} : { columnLayout }),
        ...(firstRecordAsHeader === undefined ? {} : { firstRecordAsHeader }),
        ...(showRowNumbers === undefined ? {} : { showRowNumbers }),
        updatedAt: typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt)
          ? candidate.updatedAt
          : 0,
      };
    }
    return entries;
  } catch {
    return {};
  }
}

function parseStoredColumnLayout(value: unknown): CsvStoredColumnLayout | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<CsvStoredColumnLayout>;
  if (candidate.delimiter !== "," && candidate.delimiter !== "\t") return undefined;
  if (!Array.isArray(candidate.widths) || candidate.widths.length === 0) return undefined;
  const widths = candidate.widths.filter(
    (width): width is number => typeof width === "number" && Number.isFinite(width) && width > 0,
  );
  if (widths.length !== candidate.widths.length) return undefined;
  return { delimiter: candidate.delimiter, widths };
}

function getBrowserStorage(): CsvViewPreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeDocumentId(documentId: string | undefined): string | null {
  const normalized = documentId?.trim();
  return normalized ? normalized : null;
}
