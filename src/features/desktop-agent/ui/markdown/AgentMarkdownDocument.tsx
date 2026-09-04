import { Image as ImageIcon } from "lucide-react";
import { useId, useMemo, useState, type AnchorHTMLAttributes, type ImgHTMLAttributes } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLocalization } from "@puppyone/localization/react";
import { resolveMarkdownContentLanguage } from "@puppyone/shared-ui";
import { splitStreamingMarkdown } from "../../domain/agent-stream-presentation";
import { AgentMarkdownCodeBlock } from "./AgentMarkdownCodeBlock";
import { useAgentMarkdownEnvironment } from "./AgentMarkdownEnvironment";
import type { AgentMarkdownBlockRegistry } from "./agentMarkdownBlockRegistry";
import {
  agentMarkdownLimits,
  classifyAgentMarkdownHref,
  createInitialAgentMarkdownWindow,
  transformAgentMarkdownUrl,
} from "./agentMarkdownPolicy";

export type AgentMarkdownDocumentProps = Readonly<{
  text: string;
  streaming?: boolean;
  blockRegistry?: AgentMarkdownBlockRegistry;
}>;

export function AgentMarkdownDocument({ text, streaming = false, blockRegistry }: AgentMarkdownDocumentProps) {
  const { locale, t } = useLocalization();
  const { openExternalUrl } = useAgentMarkdownEnvironment();
  const [expanded, setExpanded] = useState(false);
  const contentLanguage = useMemo(
    () => resolveMarkdownContentLanguage(text, locale),
    [locale, text],
  );
  const initial = useMemo(() => createInitialAgentMarkdownWindow(text), [text]);
  const candidate = expanded ? text : initial.source;
  const presentation = useMemo(
    () => streaming ? splitStreamingMarkdown(candidate) : { stable: candidate, tail: "" },
    [candidate, streaming],
  );
  const components = useMemo(
    () => createAgentMarkdownComponents(blockRegistry, t("agent.markdown.image"), openExternalUrl),
    [blockRegistry, openExternalUrl, t],
  );
  const documentId = useId().replace(/[^A-Za-z0-9_-]/g, "");
  return (
    <div
      className="desktop-agent-markdown"
      data-po-typography-role="content"
      lang={contentLanguage.language}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={transformAgentMarkdownUrl}
        remarkRehypeOptions={{ clobberPrefix: `agent-md-${documentId}-` }}
      >{presentation.stable}</ReactMarkdown>
      {presentation.tail && (
        <p className="desktop-agent-markdown-stream-tail">
          {presentation.tail}
          {streaming && <span className="desktop-agent-stream-caret" aria-hidden="true" />}
        </p>
      )}
      {streaming && !presentation.tail && <span className="desktop-agent-stream-caret" aria-hidden="true" />}
      {(expanded || initial.truncated) && (
        <button
          type="button"
          className="desktop-agent-markdown-disclosure"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t("agent.markdown.collapse") : t("agent.markdown.showFull")}
        </button>
      )}
    </div>
  );
}

function createAgentMarkdownComponents(
  blockRegistry: AgentMarkdownBlockRegistry | undefined,
  imageLabel: string,
  openExternalUrl: ((href: string) => void | Promise<void>) | undefined,
): Components {
  return {
    a: (props) => <AgentMarkdownLink {...props} openExternalUrl={openExternalUrl} />,
    code: ({ node: _node, className, children, ...props }) => {
      const value = String(children).replace(/\n$/, "");
      const language = /(?:^|\s)language-([^\s]+)/.exec(className ?? "")?.[1] ?? "";
      const block = Boolean(language) || String(children).endsWith("\n");
      return block
        ? <AgentMarkdownCodeBlock language={language} source={value} registry={blockRegistry} />
        : <code className={className} {...props}>{children}</code>;
    },
    pre: ({ node: _node, children }) => <>{children}</>,
    table: ({ node: _node, children, ...props }) => (
      <div className="desktop-agent-markdown-table-scroll" data-po-scrollbar="content" tabIndex={0}>
        <table {...props}>{children}</table>
      </div>
    ),
    input: ({ node: _node, ...props }) => <input {...props} disabled />,
    img: ({ node: _node, alt }) => <AgentMarkdownImagePlaceholder alt={alt} label={imageLabel} />,
  };
}

function AgentMarkdownLink({
  node: _node,
  href = "",
  onClick,
  openExternalUrl,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  node?: unknown;
  openExternalUrl?: (href: string) => void | Promise<void>;
}) {
  const target = classifyAgentMarkdownHref(href);
  if (!target) return <span>{props.children}</span>;
  if (target.kind === "fragment") return <a {...props} href={target.href} />;
  return (
    <a
      {...props}
      href={target.href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        if (!openExternalUrl) return;
        void Promise.resolve().then(() => openExternalUrl(target.href)).catch(() => {});
      }}
    />
  );
}

function AgentMarkdownImagePlaceholder({ alt, label }: Pick<ImgHTMLAttributes<HTMLImageElement>, "alt"> & { label: string }) {
  const accessibleLabel = alt?.trim() || label;
  return (
    <span className="desktop-agent-markdown-image-placeholder" role="img" aria-label={accessibleLabel}>
      <ImageIcon size={14} aria-hidden="true" />
      <span>{accessibleLabel}</span>
    </span>
  );
}

export { agentMarkdownLimits };
