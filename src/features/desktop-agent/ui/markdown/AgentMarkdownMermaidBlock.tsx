import {
  getMermaidThemeSnapshot,
  mountSanitizedMermaidSvg,
  renderMermaidDiagram,
  subscribeMermaidThemeChanges,
  type MermaidSvgMount,
} from "@puppyone/shared-ui";
import { useEffect, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { InlineLoading } from "../../../../components/loading";
import { useAgentMarkdownEnvironment } from "./AgentMarkdownEnvironment";
import { AgentMarkdownSourceBlock } from "./AgentMarkdownSourceBlock";
import type { AgentMarkdownRichBlockProps } from "./agentMarkdownBlockRegistry";

type MermaidState = "deferred" | "loading" | "ready" | "failed";

export function AgentMarkdownMermaidBlock({ source }: AgentMarkdownRichBlockProps) {
  const { t } = useLocalization();
  const { openExternalUrl } = useAgentMarkdownEnvironment();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const [themeRevision, setThemeRevision] = useState(0);
  const [state, setState] = useState<MermaidState>(visible ? "loading" : "deferred");

  useEffect(() => {
    const host = hostRef.current;
    if (!host || visible || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: "240px 0px" });
    observer.observe(host);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => subscribeMermaidThemeChanges(() => setThemeRevision((value) => value + 1)), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !visible) return;
    let cancelled = false;
    let mount: MermaidSvgMount | null = null;
    setState("loading");
    void renderMermaidDiagram({ source, theme: getMermaidThemeSnapshot(host) }).then((result) => {
      if (cancelled) return;
      mount = mountSanitizedMermaidSvg(host, result.svg, openExternalUrl);
      setState("ready");
    }).catch(() => {
      if (cancelled) return;
      host.replaceChildren();
      setState("failed");
    });
    return () => {
      cancelled = true;
      mount?.dispose();
    };
  }, [openExternalUrl, source, themeRevision, visible]);

  if (state === "failed") return <AgentMarkdownSourceBlock language="mermaid" source={source} />;

  return (
    <figure className={`desktop-agent-mermaid is-${state}`}>
      <figcaption>{t("agent.markdown.diagram")}</figcaption>
      <div className="desktop-agent-mermaid-stage">
        {state !== "ready" && (
          <InlineLoading
            label={null}
            size="xs"
            tone="neutral"
            ariaLabel={t("agent.markdown.diagramRendering")}
          />
        )}
        <div ref={hostRef} className="desktop-agent-mermaid-host" />
      </div>
    </figure>
  );
}
