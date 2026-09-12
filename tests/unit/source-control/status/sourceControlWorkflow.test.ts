import { describe, expect, it } from "vitest";
import {
  getSourceControlPrimaryActionSlot,
  type SourceControlPrimaryActionSlot,
} from "../../../../src/features/source-control/viewModel";

describe("single-branch collaboration UX policy", () => {
  const cases: Array<{
    name: string;
    state: Parameters<typeof getSourceControlPrimaryActionSlot>[0];
    expected: SourceControlPrimaryActionSlot;
  }> = [
    {
      name: "synced and clean",
      state: state(),
      expected: null,
    },
    {
      name: "only uncommitted changes",
      state: state({ hasStageAndCommitAction: true }),
      expected: "stage-and-commit",
    },
    {
      name: "only staged changes",
      state: state({ hasStagedAction: true }),
      expected: "staged",
    },
    {
      name: "only outgoing commits",
      state: state({ hasCommittedAction: true }),
      expected: "committed",
    },
    {
      name: "outgoing commits plus staged changes",
      state: state({ hasCommittedAction: true, hasStagedAction: true }),
      expected: "staged",
    },
    {
      name: "incoming commits plus a dirty worktree",
      state: state({ hasSyncAction: true, hasStageAndCommitAction: true }),
      expected: "sync",
    },
    {
      name: "incoming commits plus staged changes",
      state: state({ hasSyncAction: true, hasStagedAction: true }),
      expected: "sync",
    },
    {
      name: "diverged commits",
      state: state({ hasSyncAction: true, hasCommittedAction: true }),
      expected: "sync",
    },
    {
      name: "resolved rebase waiting to continue",
      state: state({ hasOperationAction: true, hasSyncAction: true, hasStagedAction: true }),
      expected: "operation",
    },
    {
      name: "unresolved content conflicts",
      state: state({
        hasConflicts: true,
        hasOperationAction: true,
        hasSyncAction: true,
        hasStagedAction: true,
        hasCommittedAction: true,
      }),
      expected: null,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(getSourceControlPrimaryActionSlot(testCase.state)).toBe(testCase.expected);
    });
  }
});

function state(
  overrides: Partial<Parameters<typeof getSourceControlPrimaryActionSlot>[0]> = {},
): Parameters<typeof getSourceControlPrimaryActionSlot>[0] {
  return {
    hasConflicts: false,
    hasOperationAction: false,
    hasStagedAction: false,
    hasSyncAction: false,
    hasCommittedAction: false,
    hasStageAndCommitAction: false,
    ...overrides,
  };
}
