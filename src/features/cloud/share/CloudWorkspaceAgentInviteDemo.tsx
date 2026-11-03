import { useState, type AnimationEvent, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import { agentConnectMessage } from "./agentLinks";
import type { ShareAgentMark } from "./CloudWorkspaceAgentsPanel";
import "./agent-invite-demo.css";

/** Agents a person may already use, so one of them is likely to be theirs. */
const DEMO_AGENTS = ["Claude Code", "Codex", "Grok Bot"] as const;

/**
 * Inviting, shown rather than told, while no Agent is here yet: the prompt
 * goes into an Agent's chat, the Agent asks to join, the request arrives
 * here, Allow is pressed and the Agent is at work. Each pass is another
 * Agent. It is an illustration only: nothing in it can be pressed or read
 * aloud, and the hint under the prompt says the same in words.
 */
export function CloudWorkspaceAgentInviteDemo({ projectName, linkPreview, renderAgentMark }: {
  projectName: string;
  linkPreview: string;
  renderAgentMark?: (agent: ShareAgentMark) => ReactNode;
}) {
  const { t } = useLocalization();
  const [turn, setTurn] = useState(0);
  const name = DEMO_AGENTS[turn % DEMO_AGENTS.length];
  const mark = (active: boolean) => renderAgentMark?.({ id: `demo-${name}`, name, active })
    ?? <span className="desktop-cloud-agent-lamp" data-active={active || undefined} />;
  // Every part keeps the same clock, so the stage's own pass is the one to count.
  const next = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) setTurn(current => current + 1);
  };
  return <div className="desktop-cloud-agent-demo" aria-hidden="true" data-cloud-agent-demo={name}
    onAnimationIteration={next}>
    <div className="desktop-cloud-agent-demo-chat">
      <p className="desktop-cloud-agent-demo-bubble" data-from="person" dir="ltr">
        {agentConnectMessage(projectName, linkPreview)}
      </p>
      <div className="desktop-cloud-agent-demo-reply">
        {mark(false)}
        <p className="desktop-cloud-agent-demo-bubble" data-from="agent">
          <span className="desktop-cloud-agent-demo-step" data-step="asking">
            <LoaderCircle className="animate-spin" size={11} strokeWidth={2.2} />
            {t("cloud.share.agent.demo.asking")}
          </span>
          <span className="desktop-cloud-agent-demo-step" data-step="joined">{t("cloud.share.agent.demo.joined")}</span>
        </p>
      </div>
    </div>
    <div className="desktop-cloud-agent-demo-request">
      <span className="desktop-cloud-agent-demo-step" data-step="asking">
        <span className="desktop-cloud-agent-waiting-mark">{mark(false)}</span>
        <span className="desktop-cloud-agent-demo-name">{name}</span>
        <span className="desktop-cloud-agent-demo-state">{t("cloud.share.agent.request.status")}</span>
        <span className="desktop-cloud-agent-demo-allow">{t("cloud.share.agent.request.allow")}</span>
      </span>
      <span className="desktop-cloud-agent-demo-step" data-step="joined">
        {mark(true)}
        <span className="desktop-cloud-agent-demo-name">{name}</span>
        <span className="desktop-cloud-agent-demo-state">{t("cloud.share.agent.status.active")}</span>
      </span>
    </div>
  </div>;
}
