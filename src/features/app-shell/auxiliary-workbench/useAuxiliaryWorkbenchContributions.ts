import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuxiliaryWorkbenchItem } from "@puppyone/shared-ui";
import type {
  AuxiliaryWorkbenchContribution,
  AuxiliaryWorkbenchCreationRecipe,
  AuxiliaryWorkbenchHistoryTarget,
  AuxiliaryWorkbenchPreparationContext,
} from "./types";

export type AuxiliaryWorkbenchCreationFailure = Readonly<{
  kind: string;
  label: string;
  code: string | null;
  detail: string | null;
  retryable: boolean;
}>;

type UseAuxiliaryWorkbenchContributionsOptions = Readonly<{
  contributions: readonly AuxiliaryWorkbenchContribution[];
  items: readonly AuxiliaryWorkbenchItem[];
  onReserve: (contribution: AuxiliaryWorkbenchContribution) => AuxiliaryWorkbenchItem;
  onCommit: (
    contribution: AuxiliaryWorkbenchContribution,
    item: AuxiliaryWorkbenchItem,
    targetGroupId: string | null,
    recipe: AuxiliaryWorkbenchCreationRecipe | null,
    historyTarget: AuxiliaryWorkbenchHistoryTarget | null,
  ) => string;
}>;

/**
 * Owns admission and asynchronous preparation around the pure topology.
 * A contribution is committed only after its current registration is ready.
 */
export function useAuxiliaryWorkbenchContributions({
  contributions,
  items,
  onReserve,
  onCommit,
}: UseAuxiliaryWorkbenchContributionsOptions) {
  const contributionByKind = useMemo(
    () => new Map(contributions.map((contribution) => [contribution.kind, contribution])),
    [contributions],
  );
  const [creationFailure, setCreationFailure] =
    useState<AuxiliaryWorkbenchCreationFailure | null>(null);
  const [preparingKinds, setPreparingKinds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const contributionByKindRef = useRef(contributionByKind);
  const itemsRef = useRef(items);
  const mountedRef = useRef(false);
  const onCommitRef = useRef(onCommit);
  const onReserveRef = useRef(onReserve);
  const preparingKindsRef = useRef(new Set<string>());
  const failedCreationRef = useRef<{
    failure: AuxiliaryWorkbenchCreationFailure;
    contribution: AuxiliaryWorkbenchContribution;
    targetGroupId: string | null;
    recipe: AuxiliaryWorkbenchCreationRecipe | null;
    historyTarget: AuxiliaryWorkbenchHistoryTarget | null;
  } | null>(null);
  contributionByKindRef.current = contributionByKind;
  itemsRef.current = items;
  onCommitRef.current = onCommit;
  onReserveRef.current = onReserve;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const canCreate = useCallback((
    contribution: AuxiliaryWorkbenchContribution,
    recipe: AuxiliaryWorkbenchCreationRecipe | null = null,
    historyTarget: AuxiliaryWorkbenchHistoryTarget | null = null,
  ) => (
    contributionByKindRef.current.get(contribution.kind) === contribution
    && isRegisteredCreationIntent(contribution, recipe, historyTarget)
    && !preparingKindsRef.current.has(contribution.kind)
    && countItemsOfKind(itemsRef.current, contribution.kind)
      < (contribution.maximumItems ?? Number.POSITIVE_INFINITY)
  ), []);

  const create = useCallback(async (
    contribution: AuxiliaryWorkbenchContribution,
    targetGroupId: string | null,
    recipe: AuxiliaryWorkbenchCreationRecipe | null = null,
    historyTarget: AuxiliaryWorkbenchHistoryTarget | null = null,
  ): Promise<string | null> => {
    if (!canCreate(contribution, recipe, historyTarget)) return null;
    preparingKindsRef.current.add(contribution.kind);
    setPreparingKinds(new Set(preparingKindsRef.current));
    setCreationFailure((current) => current?.kind === contribution.kind ? null : current);
    if (failedCreationRef.current?.contribution.kind === contribution.kind) failedCreationRef.current = null;
    let preparation: AuxiliaryWorkbenchPreparationContext | null = null;
    let committed = false;
    try {
      const item = onReserveRef.current(contribution);
      preparation = Object.freeze({ item, recipe, historyTarget });
      await contribution.prepare?.(preparation);
      if (
        !mountedRef.current
        || contributionByKindRef.current.get(contribution.kind) !== contribution
        || !isRegisteredCreationIntent(contribution, recipe, historyTarget)
        || countItemsOfKind(itemsRef.current, contribution.kind)
          >= (contribution.maximumItems ?? Number.POSITIVE_INFINITY)
      ) return null;
      const itemId = onCommitRef.current(
        contribution,
        preparation.item,
        targetGroupId,
        recipe,
        historyTarget,
      );
      committed = true;
      return itemId;
    } catch (error) {
      if (mountedRef.current && contributionByKindRef.current.get(contribution.kind) === contribution) {
        const failure = creationFailureFromError(contribution, error);
        failedCreationRef.current = { failure, contribution, targetGroupId, recipe, historyTarget };
        setCreationFailure(failure);
      }
      return null;
    } finally {
      if (!committed && preparation) {
        try {
          await contribution.discardPreparedItem?.(preparation);
        } catch {
          // Admission cleanup is best-effort and must not replace the original failure.
        }
      }
      preparingKindsRef.current.delete(contribution.kind);
      if (mountedRef.current) setPreparingKinds(new Set(preparingKindsRef.current));
    }
  }, [canCreate]);

  const retryCreation = useCallback(async () => {
    const intent = failedCreationRef.current;
    if (!mountedRef.current || !intent || intent.failure !== creationFailure || !intent.failure.retryable) return null;
    // Re-enter normal admission with the exact failed target. Registration,
    // ownership and limits are checked again; no fallback to a new chat.
    return create(intent.contribution, intent.targetGroupId, intent.recipe, intent.historyTarget);
  }, [create, creationFailure]);

  const dismissCreationFailure = useCallback(() => {
    failedCreationRef.current = null;
    setCreationFailure(null);
  }, []);

  return {
    canCreate,
    contributionByKind,
    create,
    creationFailure,
    dismissCreationFailure,
    retryCreation,
    preparingKinds,
  };
}

function creationFailureFromError(
  contribution: AuxiliaryWorkbenchContribution,
  error: unknown,
): AuxiliaryWorkbenchCreationFailure {
  const candidate = error && typeof error === "object"
    ? error as { code?: unknown; message?: unknown; retryable?: unknown }
    : null;
  const code = typeof candidate?.code === "string" && /^[A-Z0-9_]{1,80}$/.test(candidate.code)
    ? candidate.code
    : null;
  const detail = typeof candidate?.message === "string"
    ? candidate.message.trim().slice(0, 1_000) || null
    : null;
  return Object.freeze({
    kind: contribution.kind,
    label: contribution.label,
    code,
    detail,
    retryable: candidate?.retryable === true,
  });
}

function countItemsOfKind(items: readonly AuxiliaryWorkbenchItem[], kind: string) {
  return items.reduce((count, item) => count + (item.kind === kind ? 1 : 0), 0);
}

function isRegisteredCreationIntent(
  contribution: AuxiliaryWorkbenchContribution,
  recipe: AuxiliaryWorkbenchCreationRecipe | null,
  historyTarget: AuxiliaryWorkbenchHistoryTarget | null,
) {
  if (historyTarget) return Boolean(contribution.history) && recipe === null;
  if (!recipe) return contribution.creationRecipes === undefined;
  return contribution.creationRecipes?.includes(recipe) === true
    && recipe.status === "available";
}
