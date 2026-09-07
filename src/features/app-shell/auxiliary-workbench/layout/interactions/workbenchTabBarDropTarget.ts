export type WorkbenchTabBarDropTarget = Readonly<{
  tabBar: HTMLElement;
  targetGroupId: string;
  /** Final index after the source Session is removed from its owner. */
  targetIndex: number;
}>;

/**
 * Resolves a logical insertion slot from rendered Tab midpoints. Source Tabs
 * are excluded for same-Bar moves, which keeps the slot stable while the
 * target Header animates its siblings out of the way.
 */
export function resolveWorkbenchTabBarDropTarget(
  element: Element | null,
  excludedSessionIds: string | readonly string[],
  clientX: number,
): WorkbenchTabBarDropTarget | null {
  const tabBar = element?.closest<HTMLElement>("[data-terminal-tab-bar-group-id]");
  const targetGroupId = tabBar?.dataset.terminalTabBarGroupId;
  if (!tabBar || !targetGroupId) return null;

  const excluded = new Set(
    typeof excludedSessionIds === "string" ? [excludedSessionIds] : excludedSessionIds,
  );
  const allTabs = Array.from(tabBar.querySelectorAll<HTMLElement>(
    "[data-terminal-tab-session-id][data-terminal-tab-group-index]",
  ));
  const sourceTab = allTabs.find(
    (tab) => excluded.has(tab.dataset.terminalTabSessionId ?? ""),
  );
  const sourceIndex = sourceTab
    ? readGroupIndex(sourceTab)
    : readNonNegativeInteger(tabBar.dataset.terminalTabSourceIndex);
  const candidates = allTabs
    .filter((tab) => !excluded.has(tab.dataset.terminalTabSessionId ?? ""))
    .map((tab) => ({
      groupIndex: readGroupIndex(tab),
      rect: tab.getBoundingClientRect(),
    }));
  if (candidates.length === 0) {
    return { tabBar, targetGroupId, targetIndex: 0 };
  }

  const rightToLeft = getComputedStyle(tabBar).direction === "rtl";
  candidates.sort((left, right) => rightToLeft
    ? right.rect.right - left.rect.right
    : left.rect.left - right.rect.left);

  for (const candidate of candidates) {
    const beforeMidpoint = rightToLeft
      ? clientX > candidate.rect.left + candidate.rect.width / 2
      : clientX < candidate.rect.left + candidate.rect.width / 2;
    if (beforeMidpoint) {
      return {
        tabBar,
        targetGroupId,
        targetIndex: indexAfterSourceRemoval(candidate.groupIndex, sourceIndex),
      };
    }
  }

  const lastIndex = indexAfterSourceRemoval(
    candidates[candidates.length - 1]!.groupIndex,
    sourceIndex,
  );
  return { tabBar, targetGroupId, targetIndex: lastIndex + 1 };
}

function readGroupIndex(element: HTMLElement | undefined): number {
  return readNonNegativeInteger(element?.dataset.terminalTabGroupIndex);
}

function readNonNegativeInteger(rawValue: string | undefined): number {
  const value = Number(rawValue);
  return Number.isInteger(value) && value >= 0 ? value : -1;
}

function indexAfterSourceRemoval(index: number, sourceIndex: number): number {
  return sourceIndex >= 0 && sourceIndex < index ? index - 1 : index;
}
