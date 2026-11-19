import type { ExplorerVisibleRow } from "./explorerVisibleModel";

export type ExplorerRevealPhase = {
  start: number;
  end: number;
};

export type ExplorerRowMotionInstruction =
  | {
      kind: "enter";
      reveal: ExplorerRevealPhase;
    }
  | {
      kind: "move";
      offsetY: number;
    };

export type ExplorerExitGhost = {
  row: ExplorerVisibleRow;
  top: number;
  reveal: ExplorerRevealPhase;
};

export type ExplorerMotionPlan = {
  instructions: ReadonlyMap<string, ExplorerRowMotionInstruction>;
  ghosts: readonly ExplorerExitGhost[];
  listEndOffsetY: number;
};

/**
 * FLIP plan for the currently mounted virtual window. Work is bounded by the
 * mounted rows, never by the full expanded tree. Removed rows become inert
 * visual ghosts only when capacity remains under the global DOM-row limit.
 */
export function createExplorerMotionPlan({
  previousRows,
  nextRows,
  previousMountedRows,
  nextMountedRows,
  rowSize,
  maxMountedRows,
}: {
  previousRows: readonly ExplorerVisibleRow[];
  nextRows: readonly ExplorerVisibleRow[];
  previousMountedRows: readonly ExplorerVisibleRow[];
  nextMountedRows: readonly ExplorerVisibleRow[];
  rowSize: number;
  maxMountedRows: number;
}): ExplorerMotionPlan {
  const previousIndex = new Map(previousRows.map((row) => [row.key, row.index]));
  const previousMountedKeys = new Set(previousMountedRows.map((row) => row.key));
  const nextKeys = new Set(nextRows.map((row) => row.key));
  const enterRevealPhases = buildContiguousRevealPhases(
    nextRows,
    (row) => !previousIndex.has(row.key),
    "forward",
  );
  const exitRevealPhases = buildContiguousRevealPhases(
    previousRows,
    (row) => !nextKeys.has(row.key),
    "reverse",
  );
  const instructions = new Map<string, ExplorerRowMotionInstruction>();

  for (const row of nextMountedRows) {
    const oldIndex = previousIndex.get(row.key);
    if (oldIndex === undefined) {
      instructions.set(row.key, {
        kind: "enter",
        reveal: enterRevealPhases.get(row.key) ?? { start: 0, end: 1 },
      });
      continue;
    }
    if (!previousMountedKeys.has(row.key)) continue;
    const offsetY = (oldIndex - row.index) * rowSize;
    if (offsetY !== 0) instructions.set(row.key, { kind: "move", offsetY });
  }

  const ghostCapacity = Math.max(0, maxMountedRows - nextMountedRows.length);
  const ghosts = previousMountedRows
    .filter((row) => !nextKeys.has(row.key))
    .slice(0, ghostCapacity)
    .map((row) => ({
      row,
      top: row.index * rowSize,
      reveal: exitRevealPhases.get(row.key) ?? { start: 0, end: 1 },
    }));

  return {
    instructions,
    ghosts,
    listEndOffsetY: (previousRows.length - nextRows.length) * rowSize,
  };
}

function buildContiguousRevealPhases(
  rows: readonly ExplorerVisibleRow[],
  isAffected: (row: ExplorerVisibleRow) => boolean,
  direction: "forward" | "reverse",
): ReadonlyMap<string, ExplorerRevealPhase> {
  const phases = new Map<string, ExplorerRevealPhase>();
  let runStart = -1;

  for (let index = 0; index <= rows.length; index += 1) {
    if (index < rows.length && isAffected(rows[index]!)) {
      if (runStart < 0) runStart = index;
      continue;
    }
    if (runStart < 0) continue;

    const runLength = index - runStart;
    for (let offset = 0; offset < runLength; offset += 1) {
      const row = rows[runStart + offset];
      if (!row) continue;
      const phaseIndex = direction === "forward" ? offset : runLength - offset - 1;
      phases.set(row.key, {
        start: phaseIndex / runLength,
        end: (phaseIndex + 1) / runLength,
      });
    }
    runStart = -1;
  }

  return phases;
}
