import {
  Clock3,
  FileText,
  GitBranch,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  UserRound,
} from "lucide-react";
import { McpLogoIcon } from "./McpLogoIcon";
import { CloudOverviewHostingIllustration } from "./CloudOverviewHostingIllustration";
import { useId, type ReactNode } from "react";
import { useLocalization } from "@puppyone/localization/react";
import {
  AgentBrandImage,
  resolveAgentBrand,
  type AgentBrandId,
} from "@puppyone/shared-ui";
import type { CloudWorkspaceSection } from "../types";
import { CloudPublishFolderMark } from "./CloudPublishHeroMarks";
import "./mcp-activation.css";

type CloudActivationKind = "overview" | "mcp" | "cli" | "git" | "automation" | "access";

const ACTIVATION_COPY = {
  overview: {
    titleId: "cloud.productName",
    descriptionId: "cloud.activation.overview.description",
  },
  mcp: {
    titleId: "cloud.route.mcp.title",
    descriptionId: "cloud.activation.mcp.description",
  },
  cli: {
    titleId: "cloud.route.cli.title",
    descriptionId: "cloud.activation.cli.description",
  },
  git: {
    titleId: "cloud.route.git-sync.title",
    descriptionId: "cloud.activation.git.description",
  },
  automation: {
    titleId: "cloud.route.automation.title",
    descriptionId: "cloud.activation.automation.description",
  },
  access: {
    titleId: "cloud.route.access.title",
    descriptionId: "cloud.activation.access.description",
  },
} as const;

export function CloudActivationHero({
  activeSection,
  ariaLabel,
  className,
  titleId,
  action,
  supplemental,
}: {
  activeSection: CloudWorkspaceSection;
  ariaLabel?: string;
  className?: string;
  titleId?: string;
  action: ReactNode;
  supplemental?: ReactNode;
}) {
  const { t } = useLocalization();
  const generatedTitleId = useId();
  const resolvedTitleId = titleId ?? generatedTitleId;
  const kind = getCloudActivationKind(activeSection);
  const connection = isConnectionActivationKind(kind);
  const copy = ACTIVATION_COPY[kind];
  const title = t(copy.titleId);
  const rootClassName = [
    "desktop-cloud-mcp-activation",
    `is-${kind}`,
    connection && "is-connection",
    className,
  ].filter(Boolean).join(" ");

  return (
    <section
      className={rootClassName}
      aria-label={ariaLabel ?? title}
      aria-labelledby={resolvedTitleId}
    >
      <div className="desktop-cloud-mcp-activation-copy">
        <header className="desktop-cloud-mcp-activation-header">
          <h1 id={resolvedTitleId}>{title}</h1>
          <p className="desktop-entry-state-description desktop-cloud-mcp-activation-description">
            {t(copy.descriptionId)}
          </p>
        </header>

        {supplemental && (
          <div className="desktop-cloud-mcp-activation-supplemental">
            {supplemental}
          </div>
        )}

        <div className="desktop-cloud-mcp-activation-actions">
          {action}
        </div>
      </div>

      <CloudActivationIllustration kind={kind} />
    </section>
  );
}

function getCloudActivationKind(section: CloudWorkspaceSection): CloudActivationKind {
  if (section === "automation") return "automation";
  if (section === "access") return "access";
  if (section === "cli") return "cli";
  if (section === "git-sync") return "git";
  if (["contents", "share", "project", "history", "settings"].includes(section)) return "overview";
  return "mcp";
}

function isConnectionActivationKind(kind: CloudActivationKind): boolean {
  return kind === "mcp" || kind === "cli" || kind === "git";
}

function CloudActivationIllustration({ kind }: { kind: CloudActivationKind }) {
  const illustration = kind === "overview"
    ? <CloudOverviewActivationIllustration />
    : kind === "cli"
      ? <CloudCliConnectionIllustration />
      : kind === "git"
        ? <CloudGitConnectionIllustration />
        : kind === "automation"
          ? <CloudAutomationActivationIllustration />
          : kind === "access"
            ? <CloudAccessActivationIllustration />
            : <CloudMcpConnectionIllustration />;

  return (
    <div
      className={[
        "desktop-cloud-activation-illustration-frame",
        `is-${kind}`,
        isConnectionActivationKind(kind) && "is-connection",
      ].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      {illustration}
    </div>
  );
}

function CloudOverviewActivationIllustration() {
  return (
    <div className="desktop-cloud-activation-illustration is-overview" aria-hidden="true">
      <CloudOverviewHostingIllustration />
    </div>
  );
}

function CloudAutomationActivationIllustration() {
  return (
    <div className="desktop-cloud-activation-illustration is-automation" aria-hidden="true">
      <div className="desktop-cloud-activation-schedule-card">
        <span><Clock3 size={19} /><strong>09:00</strong></span>
        <span className="desktop-cloud-activation-faux-copy"><i /><i /></span>
      </div>
      <span className="desktop-cloud-activation-automation-link">
        <i /><i /><Sparkles size={22} /><i /><i />
      </span>
      <span className="desktop-cloud-activation-file-card"><FileText size={25} /></span>
    </div>
  );
}

function CloudAccessActivationIllustration() {
  return (
    <div className="desktop-cloud-activation-illustration is-access" aria-hidden="true">
      <span className="desktop-cloud-activation-identity"><UserRound size={22} /></span>
      <span className="desktop-cloud-activation-access-link" />
      <span className="desktop-cloud-activation-access-folder">
        <CloudPublishFolderMark />
        <ShieldCheck />
      </span>
      <span className="desktop-cloud-activation-access-link" />
      <span className="desktop-cloud-activation-identity"><Sparkles size={22} /></span>
    </div>
  );
}

function CloudMcpConnectionIllustration() {
  return (
    <div className="desktop-cloud-mcp-illustration" aria-hidden="true">
      <div className="desktop-cloud-mcp-folder">
        <CloudPublishFolderMark className="desktop-cloud-mcp-folder-shape" />
        <McpLogoIcon className="desktop-cloud-mcp-folder-logo" />
      </div>
      <span className="desktop-cloud-mcp-connector" />
      <div className="desktop-cloud-mcp-phone is-cropped">
        <span className="desktop-cloud-mcp-phone-speaker" />
        <div className="desktop-cloud-mcp-agent-grid">
          <AgentTile label="ChatGPT" kind="chatgpt" />
          <AgentTile label="Claude" kind="claude" />
          <AgentTile label="Cursor" kind="cursor" />
          <AgentTile label="Manus" kind="manus" />
          <AgentTile label="Hermes" kind="hermes" />
          <AgentTile label="Grok" kind="grok" />
        </div>
      </div>
    </div>
  );
}

function CloudCliConnectionIllustration() {
  return (
    <div className="desktop-cloud-channel-illustration is-cli" aria-hidden="true">
      <CloudChannelFolder icon={<SquareTerminal />} />
      <span className="desktop-cloud-channel-connector" />
      <div className="desktop-cloud-channel-panel is-terminal">
        <span className="desktop-cloud-channel-panel-header"><i /><i /><i /></span>
        <span className="desktop-cloud-channel-command"><b>$</b><i /></span>
        <span className="desktop-cloud-channel-command"><b>›</b><i /></span>
        <span className="desktop-cloud-channel-command"><b>›</b><i /></span>
      </div>
    </div>
  );
}

function CloudGitConnectionIllustration() {
  return (
    <div className="desktop-cloud-channel-illustration is-git" aria-hidden="true">
      <CloudChannelFolder icon={<GitBranch />} />
      <span className="desktop-cloud-channel-connector" />
      <div className="desktop-cloud-channel-panel is-git">
        <span className="desktop-cloud-channel-git-heading">
          <GitBranch />
          <i />
          <b />
        </span>
        <span className="desktop-cloud-channel-commit"><i /><b /><em /></span>
        <span className="desktop-cloud-channel-commit"><i /><b /><em /></span>
        <span className="desktop-cloud-channel-commit"><i /><b /><em /></span>
      </div>
    </div>
  );
}

function CloudChannelFolder({ icon }: { icon: ReactNode }) {
  return (
    <div className="desktop-cloud-channel-folder">
      <CloudPublishFolderMark className="desktop-cloud-channel-folder-shape" />
      <span className="desktop-cloud-channel-folder-icon">{icon}</span>
    </div>
  );
}

type AgentKind = Extract<AgentBrandId, "chatgpt" | "claude" | "cursor" | "manus" | "hermes"> | "grok";

function AgentTile({ label, kind }: { label: string; kind: AgentKind }) {
  return (
    <div className={`desktop-cloud-mcp-agent is-${kind}`}>
      <span className="desktop-cloud-mcp-agent-icon">
        <AgentMark kind={kind} />
      </span>
      <span>{label}</span>
    </div>
  );
}

function AgentMark({ kind }: { kind: AgentKind }) {
  const brand = resolveAgentBrand({ id: kind });
  if (brand) return <AgentBrandImage brandId={brand.id} />;

  return (
    <svg viewBox="0 0 40 40" fill="none" focusable="false">
      <path d="M29.8 13.4a12.2 12.2 0 1 0 1.3 11.4" />
      <path d="M8.4 32.1 31.9 8.6" />
    </svg>
  );
}
