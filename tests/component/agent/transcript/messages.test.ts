/** @vitest-environment happy-dom */

import { AgentSessionActor } from "../../../../electron/main/agent/domain/agent-session-actor.mjs";
import React from "react";

import { act } from "react";
import { describe, expect, it } from "vitest";

import { AgentMessagePart } from "../../../../src/features/desktop-agent/ui/AgentMessagePart";

import { AgentTranscript } from "../../../../src/features/desktop-agent/ui/AgentTranscript";

import { withTestLocalization } from "../../../support/react/localization";
import { root, render } from "../../../support/agent/rendererHarness";

describe("Desktop Agent renderer surfaces", () => {
  it.each(["queued", "outcome-unknown", "rejected", "cancelled"] as const)("keeps %s delivery information readable without the old corner footer", (deliveryStatus) => {
    const container = render(React.createElement(AgentMessagePart, {
      runtimeLabel: "Codex",
      part: { id: "user", kind: "user", text: "My prompt", turnId: null, itemId: null,
        sequence: 1, streaming: false, terminalState: null, deliveryStatus },
    }));
    expect(container.querySelector('[role="status"]')?.textContent?.trim()).toBeTruthy();
    expect(container.querySelector('.desktop-agent-queued-submission-status')).toBeNull();
    expect(container.textContent).toContain("My prompt");
    expect(container.textContent).not.toContain("Sending");
  });

  it('renders the same Main user part through admission, echo and completion without a duplicate bubble', () => {
    const actor = new AgentSessionActor();
    actor.dispatch({type:'command.received',command:{commandId:'one',operationId:'operation',kind:'start',status:'dispatching',userMessageId:'client',intentFingerprint:'fingerprint',intent:{prompt:'Hello once',promptMentions:[],referenceDisplays:[],model:null,effort:null,mode:null}}});
    const container = render(React.createElement(AgentTranscript,{projection:actor.display,loading:false}));
    expect(container.querySelectorAll('.desktop-agent-message.is-user')).toHaveLength(1);
    expect(container.textContent).toBe('Hello once');
    expect(container.querySelector('.desktop-agent-message.is-user [role="status"]')).toBeNull();
    for (const event of [
      {type:'turn.started',payload:{userMessageId:'client',submissionId:'one'}},
      {type:'user.message',itemId:'native',payload:{clientUserMessageId:'client',text:'Native compiled input'}},
      {type:'turn.completed',payload:{}},
    ]) {
      actor.appendEvent({sessionId:'session',runtimeId:'codex',event:{...event,turnId:'turn'}});
      act(()=>root?.render(withTestLocalization(React.createElement(AgentTranscript,{projection:actor.display,loading:false}))));
      expect(container.querySelectorAll('.desktop-agent-message.is-user')).toHaveLength(1);
      expect(container.textContent).toContain('Hello once');
      expect(container.textContent).not.toContain('Native compiled input');
      expect(container.querySelector('.desktop-agent-message.is-user [role="status"]')).toBeNull();
    }
    expect(container.textContent).not.toContain('Sending');
  });

  it('discloses partial reply content without pretending the native turn failed', () => {
    const actor = new AgentSessionActor();
    actor.appendEvent({sessionId:'session',runtimeId:'codex',event:{type:'assistant.completed',turnId:'turn',itemId:'answer',payload:{text:'Visible prefix',truncated:true}}});
    const container = render(React.createElement(AgentTranscript,{projection:actor.display,loading:false}));
    expect(container.textContent).toContain('Only part of this reply is available in this view.');
    expect(container.querySelector('.desktop-agent-message-state.is-failed')).toBeNull();
  });
});
