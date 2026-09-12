import { vi } from 'vitest';
import { createAgentSessionRecord } from '../../../electron/main/agent/domain/agent-session-model.mjs';
import { AgentSessionFeed } from '../../../electron/main/agent/application/session/agent-session-feed.mjs';

/** Smoke-runner fixtures use the production Actor and feed, never a parallel wire format. */
export function fakeSessionFeed(sender) {
  const feed = new AgentSessionFeed();
  let session = null;
  return {
    methods: {
      attachSession: vi.fn(async (_sender, request) => {
        session = createAgentSessionRecord({id:request.sessionId,ownerId:sender.id,sender,workspaceRoot:'/workspace',runtimeId:'fixture',model:null,effort:null,mode:null});
        return feed.attach(session);
      }),
      acknowledgeSession: vi.fn(async (_sender, request) => feed.acknowledge(session, request)),
      detachSession: vi.fn(async (_sender, request) => {
        const result = feed.detach(session, request.subscriptionId);
        feed.releaseSession(session.id); session = null;
        return result;
      }),
    },
    publish(events) {
      if (!session) throw new Error('The fake Agent feed is not attached.');
      for (const event of events) session.actor.appendEvent({sessionId:session.id,runtimeId:event.runtimeId??'fixture',providerSessionId:'native',event});
    },
  };
}
