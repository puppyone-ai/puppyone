import type { FolderRelationshipEdge } from "./contextMapGraph";

export type ContextMapLineFilterState = Readonly<{
  oneWayLinks: boolean;
  bidirectionalLinks: boolean;
}>;

export type ContextMapLineFilterKey = keyof ContextMapLineFilterState;

export const DEFAULT_CONTEXT_MAP_LINE_FILTERS: ContextMapLineFilterState = Object.freeze({
  oneWayLinks: true,
  bidirectionalLinks: true,
});

export function isContextMapReferenceVisible(
  edge: Pick<FolderRelationshipEdge, "bidirectional">,
  filters: ContextMapLineFilterState,
): boolean {
  return edge.bidirectional ? filters.bidirectionalLinks : filters.oneWayLinks;
}

export function updateContextMapLineFilter(
  filters: ContextMapLineFilterState,
  key: ContextMapLineFilterKey,
  visible: boolean,
): ContextMapLineFilterState {
  if (filters[key] === visible) return filters;
  return { ...filters, [key]: visible };
}
