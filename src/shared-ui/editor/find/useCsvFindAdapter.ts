import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type {
  EditorFindAdapter,
  EditorFindDirection,
  EditorFindResult,
} from "./editorFind";

export type CsvFindMatch = Readonly<{
  columnIndex: number;
  rowIndex: number;
}>;

export function getCsvFindMatchKey(match: CsvFindMatch): string {
  return `${match.rowIndex}:${match.columnIndex}`;
}

export function useCsvFindAdapter(
  rows: readonly Readonly<{ cells: readonly string[] }>[],
  tableRef: RefObject<HTMLTableElement>,
  onReveal?: (match: CsvFindMatch, focus: boolean) => void,
) {
  const rowsRef = useRef(rows);
  const onRevealRef = useRef(onReveal);
  rowsRef.current = rows;
  onRevealRef.current = onReveal;
  const [matches, setMatches] = useState<readonly CsvFindMatch[]>([]);
  const [current, setCurrent] = useState(-1);
  const matchesRef = useRef<readonly CsvFindMatch[]>([]);
  const currentRef = useRef(-1);
  const queryRef = useRef("");
  const listenersRef = useRef(new Set<(result: EditorFindResult) => void>());

  const apply = useCallback((nextMatches: readonly CsvFindMatch[], nextCurrent: number) => {
    matchesRef.current = nextMatches;
    currentRef.current = nextCurrent;
    setMatches(nextMatches);
    setCurrent(nextCurrent);
    const result = snapshot(nextMatches, nextCurrent);
    for (const listener of listenersRef.current) listener(result);
    return result;
  }, []);

  const reveal = useCallback((match: CsvFindMatch | undefined, focus = false) => {
    if (!match) return;
    if (onRevealRef.current) {
      onRevealRef.current(match, focus);
      return;
    }
    const input = tableRef.current?.querySelector<HTMLInputElement>(
      `input[data-csv-row="${match.rowIndex}"][data-csv-column="${match.columnIndex}"]`,
    );
    if (focus) input?.focus();
    else input?.scrollIntoView({ block: "center", inline: "center" });
  }, [tableRef]);

  const refresh = useCallback((selectFirst: boolean) => {
    const normalizedQuery = queryRef.current.toLocaleLowerCase();
    if (!normalizedQuery) return apply([], -1);
    const nextMatches: CsvFindMatch[] = [];
    rowsRef.current.forEach((row, rowIndex) => {
      row.cells.forEach((value, columnIndex) => {
        if (value.toLocaleLowerCase().includes(normalizedQuery)) {
          nextMatches.push({ columnIndex, rowIndex });
        }
      });
    });
    const nextCurrent = nextMatches.length === 0
      ? -1
      : selectFirst || currentRef.current < 0 || currentRef.current >= nextMatches.length
        ? 0
        : currentRef.current;
    reveal(nextMatches[nextCurrent]);
    return apply(nextMatches, nextCurrent);
  }, [apply, reveal]);

  const adapter = useMemo<EditorFindAdapter>(() => ({
    setQuery(query) {
      queryRef.current = query;
      return refresh(true);
    },
    move(direction: EditorFindDirection) {
      const currentMatches = matchesRef.current;
      if (currentMatches.length === 0) return snapshot(currentMatches, -1);
      const nextCurrent = direction === "next"
        ? (currentRef.current + 1) % currentMatches.length
        : (currentRef.current - 1 + currentMatches.length) % currentMatches.length;
      reveal(currentMatches[nextCurrent]);
      return apply(currentMatches, nextCurrent);
    },
    clear() {
      queryRef.current = "";
      apply([], -1);
    },
    focusEditor() {
      const match = matchesRef.current[currentRef.current];
      if (match && onRevealRef.current) {
        reveal(match, true);
        return;
      }
      const selector = match
        ? `input[data-csv-row="${match.rowIndex}"][data-csv-column="${match.columnIndex}"]`
        : "input[data-csv-row][data-csv-column]";
      tableRef.current?.querySelector<HTMLInputElement>(selector)?.focus();
    },
    subscribe(listener) {
      listenersRef.current.add(listener);
      return () => listenersRef.current.delete(listener);
    },
  }), [apply, refresh, reveal, tableRef]);

  useEffect(() => {
    if (queryRef.current) refresh(false);
  }, [refresh, rows]);

  const matchKeys = useMemo(() => new Set(matches.map(getCsvFindMatchKey)), [matches]);

  return {
    adapter,
    currentMatch: current >= 0 ? matches[current] : null,
    matchKeys,
  };
}

function snapshot(matches: readonly CsvFindMatch[], current: number): EditorFindResult {
  return {
    current: current >= 0 ? current + 1 : 0,
    total: matches.length,
  };
}
