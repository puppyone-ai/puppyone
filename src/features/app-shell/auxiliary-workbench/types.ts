import type { ReactNode } from "react";
import type { ProjectSessionContext } from "../../../../shared/project-session-contract/types";

export interface AuxiliaryWorkbenchProject {
  readonly context: ProjectSessionContext;
  readonly disposed: boolean;
  assertOpen(): void;
  getResource<T extends { dispose(): void }>(key: string, create: () => T): T;
}
import type {
  AuxiliaryWorkbenchItem,
  WorkbenchSplitMinimumSize,
} from "@puppyone/shared-ui";

export type AuxiliaryWorkbenchPresentationState = Readonly<{
  sidebarVisible: boolean;
  presented: boolean;
  commandTarget: boolean;
  domFocused: boolean;
}>;

export type AuxiliaryWorkbenchItemSnapshot = Readonly<{
  title: string;
  accessibleLabel: string;
  detail: string | null;
  /** Product mark rendered by generic Workbench chrome. */
  iconKey: string | null;
  status: "idle" | "selecting" | "starting" | "running" | "exited" | "error";
  running: boolean;
  /** Feature-owned native resource identity, never part of the topology. */
  resourceId: string | null;
}>;

export type AuxiliaryWorkbenchItemRenderContext = Readonly<{
  project?: AuxiliaryWorkbenchProject;
  item: AuxiliaryWorkbenchItem;
  presentation: AuxiliaryWorkbenchPresentationState;
  peerSnapshots: ReadonlyMap<string, AuxiliaryWorkbenchItemSnapshot>;
  onPresentationChange: (snapshot: AuxiliaryWorkbenchItemSnapshot) => void;
}>;

/**
 * Opaque resource chosen from a contribution-owned history browser.
 * Workbench transports the target but never interprets a Harness session id.
 */
export type AuxiliaryWorkbenchHistoryTarget = Readonly<{
  id: string;
  title: string;
  iconKey: string | null;
  payload: unknown;
}>;

export type AuxiliaryWorkbenchHistoryBrowserContext = Readonly<{
  project?: AuxiliaryWorkbenchProject;
  instanceId: string;
  rootId: string;
  rootPath: string;
  excludedResourceIds: readonly string[];
  openingTargetId: string | null;
  onBack: () => void;
  onOpen: (target: AuxiliaryWorkbenchHistoryTarget) => void;
}>;

export type AuxiliaryWorkbenchHistoryContribution = Readonly<{
  label: string;
  iconKey: string | null;
  renderBrowser: (context: AuxiliaryWorkbenchHistoryBrowserContext) => ReactNode;
}>;

export type AuxiliaryWorkbenchCreationRecipe = Readonly<{
  id: string;
  label: string;
  iconKey: string | null;
  status: "available" | "unavailable" | "coming-soon";
}>;

export type AuxiliaryWorkbenchPreparationContext = Readonly<{
  project?: AuxiliaryWorkbenchProject;
  item: AuxiliaryWorkbenchItem;
  recipe: AuxiliaryWorkbenchCreationRecipe | null;
  historyTarget: AuxiliaryWorkbenchHistoryTarget | null;
}>;

export type AuxiliaryWorkbenchCloseContext = Readonly<{
  project?: AuxiliaryWorkbenchProject;
  item: AuxiliaryWorkbenchItem;
  snapshot: AuxiliaryWorkbenchItemSnapshot;
}>;

export type AuxiliaryWorkbenchCloseDialogCopy = Readonly<{
  title: string;
  detail: string;
  actionLabel: string;
}>;

/**
 * A close request is evaluated before native ownership is released. Keeping
 * this decision explicit prevents lifecycle state from leaking into generic
 * Tab chrome and gives every contribution the same confirmation boundary.
 */
export type AuxiliaryWorkbenchCloseDecision =
  | Readonly<{ kind: "close" }>
  | Readonly<{
    kind: "confirm";
    tone: "danger" | "primary";
    dialog: AuxiliaryWorkbenchCloseDialogCopy;
  }>
  | Readonly<{
    kind: "blocked";
    dialog: AuxiliaryWorkbenchCloseDialogCopy;
  }>;

export type AuxiliaryWorkbenchCloseAdapter = Readonly<{
  decide: (
    context: AuxiliaryWorkbenchCloseContext,
  ) => AuxiliaryWorkbenchCloseDecision | Promise<AuxiliaryWorkbenchCloseDecision>;
  /** Returns true only after feature-owned resources are safe to detach. */
  commit: (context: AuxiliaryWorkbenchCloseContext) => boolean | Promise<boolean>;
}>;

export type AuxiliaryWorkbenchContribution = Readonly<{
  kind: string;
  label: string;
  createLabel: string;
  initialSnapshot: AuxiliaryWorkbenchItemSnapshot;
  maximumItems?: number;
  minimumSize: WorkbenchSplitMinimumSize;
  getMinimumSize?: (context: AuxiliaryWorkbenchCloseContext) => WorkbenchSplitMinimumSize | null;
  creationRecipes?: readonly AuxiliaryWorkbenchCreationRecipe[];
  /** Optional feature-owned browser for explicitly restoring durable resources. */
  history?: AuxiliaryWorkbenchHistoryContribution;
  /** Resolve feature code and creation prerequisites before topology commits. */
  prepare?: (context: AuxiliaryWorkbenchPreparationContext) => Promise<void>;
  /** Dispose feature state prepared for an Item that admission never committed. */
  discardPreparedItem?: (context: AuxiliaryWorkbenchPreparationContext) => void | Promise<void>;
  renderItem: (context: AuxiliaryWorkbenchItemRenderContext) => ReactNode;
  renderStatus?: (context: AuxiliaryWorkbenchCloseContext) => ReactNode;
  close: AuxiliaryWorkbenchCloseAdapter;
}>;
