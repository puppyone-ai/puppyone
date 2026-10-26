import {
  Copy,
  ExternalLink,
  GitBranch,
  Link,
  Monitor,
  Server,
  Settings,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { MessageFormatter } from "@puppyone/localization/core";
import {
  DisclosureIcon,
  RENDERER_ASSET_PATHS,
  resolveRendererPublicAssetUrl,
} from "@puppyone/shared-ui";
import { formatProviderLabel, providerIcon } from "../../utils";
import type { AccessPoint, AccessPointCatalogKind, AccessPointKind } from "../model/accessPoint";
import { resolveAccessPointKind } from "../model/accessPointKindRegistry";

export type AccessPointMethodMeta = Readonly<{
  title: string;
  description: string;
  actionLabel: string;
  expandedActionLabel: string;
  actionIcon: ReactNode;
  previewButtonLabel: string;
  previewIcon: ReactNode;
}>;

export type AccessPointUiDefinition = Readonly<{
  tileProvider: "cli" | "git" | "mcp" | "vm" | "automation";
  icon: LucideIcon | "git-brand";
  iconSize: number;
  methodMeta: (accessPoint: AccessPoint, t: MessageFormatter) => AccessPointMethodMeta;
}>;

export type AccessPointCatalogDefinition = Readonly<{
  kind: AccessPointCatalogKind;
  labelId: string;
  titleId: string;
  descriptionId: string;
  emptyTitleId: string;
  emptyDetailId: string;
  icon: LucideIcon | typeof AccessChainIcon;
}>;

export const ACCESS_POINT_UI_REGISTRY: Record<AccessPointKind, AccessPointUiDefinition> = {
  cli: {
    tileProvider: "cli",
    icon: SquareTerminal,
    iconSize: 17,
    methodMeta: (_accessPoint, t) => ({
      title: t("cloud.access.method.cli.title"),
      description: t("cloud.access.method.cli.description"),
      actionLabel: t("cloud.access.method.cli.action"),
      expandedActionLabel: t("cloud.access.method.hideConfig"),
      actionIcon: <Settings size={12} />,
      previewButtonLabel: t("cloud.common.copyPrompt"),
      previewIcon: <Copy size={14} />,
    }),
  },
  git: {
    tileProvider: "git",
    icon: "git-brand",
    iconSize: 34,
    methodMeta: (_accessPoint, t) => ({
      title: t("cloud.access.surface.git.title"),
      description: t("cloud.access.method.git.description"),
      actionLabel: t("cloud.access.method.git.action"),
      expandedActionLabel: t("cloud.access.method.git.hide"),
      actionIcon: <ExternalLink size={12} />,
      previewButtonLabel: t("cloud.common.copyPrompt"),
      previewIcon: <Copy size={14} />,
    }),
  },
  mcp: {
    tileProvider: "mcp",
    icon: Server,
    iconSize: 19,
    methodMeta: (accessPoint, t) => ({
      title: t("cloud.access.surface.mcp.title"),
      description: accessPoint.status.kind === "missing"
        ? t("cloud.access.surface.mcp.prompt")
        : t("cloud.access.method.mcp.connectedDescription"),
      actionLabel: accessPoint.status.kind === "missing"
        ? t("cloud.access.method.mcp.create")
        : t("cloud.access.method.showConfig"),
      expandedActionLabel: t("cloud.access.method.hideConfig"),
      actionIcon: <DisclosureIcon expanded={false} size={12} />,
      previewButtonLabel: t("cloud.access.method.mcp.viewConnection"),
      previewIcon: <ExternalLink size={14} />,
    }),
  },
  vm: {
    tileProvider: "vm",
    icon: Monitor,
    iconSize: 18,
    methodMeta: (_accessPoint, t) => ({
      title: t("cloud.access.surface.vm.title"),
      description: t("cloud.access.surface.vm.prompt"),
      actionLabel: t("cloud.access.method.vm.addSshKey"),
      expandedActionLabel: t("cloud.access.method.vm.hideRemote"),
      actionIcon: <DisclosureIcon expanded={false} size={12} />,
      previewButtonLabel: t("cloud.access.method.vm.openRemote"),
      previewIcon: <ExternalLink size={14} />,
    }),
  },
  custom: {
    tileProvider: "automation",
    icon: Link,
    iconSize: 19,
    methodMeta: (accessPoint, t) => ({
      title: accessPoint.title || formatProviderLabel(accessPoint.sourceProvider, t),
      description: accessPoint.subtitle || t("cloud.access.method.generic.description", {
        provider: formatProviderLabel(accessPoint.sourceProvider, t),
      }),
      actionLabel: t("cloud.common.open"),
      expandedActionLabel: t("cloud.common.hide"),
      actionIcon: <DisclosureIcon expanded={false} size={12} />,
      previewButtonLabel: t("cloud.common.copyPrompt"),
      previewIcon: <Copy size={14} />,
    }),
  },
};

export const ACCESS_POINT_CATALOG_REGISTRY: Record<AccessPointCatalogKind, AccessPointCatalogDefinition> = {
  all: {
    kind: "all",
    labelId: "cloud.access.filter.all.label",
    titleId: "cloud.access.resources",
    descriptionId: "cloud.route.access.description",
    emptyTitleId: "cloud.access.filter.all.emptyTitle",
    emptyDetailId: "cloud.access.filter.all.emptyDetail",
    icon: AccessChainIcon,
  },
  cli: {
    kind: "cli",
    labelId: "cloud.access.filter.cli.label",
    titleId: "cloud.route.cli.title",
    descriptionId: "cloud.route.cli.description",
    emptyTitleId: "cloud.access.filter.cli.emptyTitle",
    emptyDetailId: "cloud.access.filter.cli.emptyDetail",
    icon: SquareTerminal,
  },
  git: {
    kind: "git",
    labelId: "cloud.access.filter.git.label",
    titleId: "cloud.route.git-sync.title",
    descriptionId: "cloud.route.git-sync.description",
    emptyTitleId: "cloud.access.filter.git.emptyTitle",
    emptyDetailId: "cloud.access.filter.git.emptyDetail",
    icon: GitBranch,
  },
  mcp: {
    kind: "mcp",
    labelId: "cloud.access.filter.mcp.label",
    titleId: "cloud.route.mcp.title",
    descriptionId: "cloud.route.mcp.description",
    emptyTitleId: "cloud.access.filter.mcp.emptyTitle",
    emptyDetailId: "cloud.access.filter.mcp.emptyDetail",
    icon: Server,
  },
};

export const ACCESS_POINT_CATALOG_KINDS = ["all", "cli", "git", "mcp"] as const satisfies readonly AccessPointCatalogKind[];

export function getAccessPointUiDefinition(kind: AccessPointKind): AccessPointUiDefinition {
  return ACCESS_POINT_UI_REGISTRY[kind];
}

export function getAccessPointCatalogDefinition(kind: AccessPointCatalogKind): AccessPointCatalogDefinition {
  return ACCESS_POINT_CATALOG_REGISTRY[kind];
}

export function getAccessPointCatalogPresentation(kind: AccessPointCatalogKind, t: MessageFormatter) {
  const definition = getAccessPointCatalogDefinition(kind);
  return {
    ...definition,
    label: t(definition.labelId),
    title: t(definition.titleId),
    description: t(definition.descriptionId),
    emptyTitle: t(definition.emptyTitleId),
    emptyDetail: t(definition.emptyDetailId),
  };
}

export function getAccessPointMethodMeta(accessPoint: AccessPoint, t: MessageFormatter): AccessPointMethodMeta {
  return getAccessPointUiDefinition(accessPoint.kind).methodMeta(accessPoint, t);
}

export function AccessPointIcon({ accessPoint, size }: { accessPoint: AccessPoint; size?: number }) {
  return (
    <AccessPointProviderIcon
      kind={accessPoint.kind}
      sourceProvider={accessPoint.sourceProvider}
      size={size}
    />
  );
}

export function AccessPointProviderIcon({
  kind,
  sourceProvider,
  size,
}: {
  kind?: AccessPointKind;
  sourceProvider: string;
  size?: number;
}) {
  const resolvedKind = kind ?? resolveAccessPointKind(sourceProvider);
  const definition = getAccessPointUiDefinition(resolvedKind);
  const resolvedSize = size ?? definition.iconSize;
  if (definition.icon === "git-brand") {
    return (
      <img
        className="desktop-cloud-access-git-brand-icon"
        src={resolveRendererPublicAssetUrl(RENDERER_ASSET_PATHS.icons.integrations.gitInverse)}
        alt=""
        width={resolvedSize}
        height={resolvedSize}
      />
    );
  }
  if (resolvedKind === "custom") {
    const ProviderIcon = providerIcon(sourceProvider);
    return <ProviderIcon size={resolvedSize} />;
  }
  const Icon = definition.icon;
  return <Icon size={resolvedSize} />;
}

export function AccessChainIcon({ size = 15, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
