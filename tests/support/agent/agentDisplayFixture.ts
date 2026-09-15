import { vi } from 'vitest';
import { projectAgentControlView } from '../../../electron/main/agent/domain/agent-control-view.mjs';
import { createAgentSessionControl, reduceAgentSessionControl } from '../../../electron/main/agent/domain/agent-session-control.mjs';
import { projectAgentDisplayControl } from '../../../electron/main/agent/domain/transcript/display-control.mjs';
import { associateAgentUserMessage } from "../../../electron/main/agent/domain/transcript/message-identity.mjs";
import { createAgentProjection, projectAgentUserSubmission, applyAgentEvent as reduceContent } from '../../../electron/main/agent/domain/transcript/transcript-reducer.mjs';
import { createAgentDisplayPatch } from '../../../shared/agent-contract/display-state.mjs';
import type { AgentProjection } from "../../../shared/agent-contract/display-types";
import type { AgentEvent, AgentSessionSnapshot } from "../../../shared/agent-contract/types";
export { agentProjectionLimits, createAgentProjection } from '../../../electron/main/agent/domain/transcript/transcript-reducer.mjs';
export type * from '../../../shared/agent-contract/display-types';
const controls = new WeakMap<object, any>();

/** Fixtures exercise the same Main control/content projection pipeline as production. */
export function applyAgentEvent(display: AgentProjection, event: AgentEvent, options?: Parameters<typeof reduceContent>[2]): AgentProjection {
  let control = controls.get(display) ?? createAgentSessionControl({ streamId: 'fixture-stream', sessionEpoch: 'fixture-epoch' });
  control = reduceAgentSessionControl(control, { type: 'event.accepted', event });
  const next = projectAgentDisplayControl(reduceContent(display, event, options), control);
  controls.set(next, control);
  return next;
}
export function applyAgentEvents(display: AgentProjection, events: AgentEvent[], options?: Parameters<typeof reduceContent>[2]): AgentProjection {
  return events.reduce((value, event) => applyAgentEvent(value, event, options), display);
}
export function finalizeDisplay(display: AgentProjection): AgentProjection {
  return projectAgentDisplayControl(display, controls.get(display) ?? createAgentSessionControl());
}
export function displaySnapshot(raw: any): AgentSessionSnapshot {
  let control = raw.control ?? createAgentSessionControl({ streamId: `stream:${raw.session.id}`, sessionEpoch: `epoch:${raw.session.id}` });
  if (!raw.control) control = reduceAgentSessionControl(control, { type: 'adapter.attached' });
  let display = createAgentProjection();
  for (const event of raw.events ?? []) {
    display = reduceContent(display, event);
    if (!raw.control) control = reduceAgentSessionControl(control, { type: 'event.accepted', event });
  }
  display = projectAgentDisplayControl(display, control);
  return { ...raw, display, control, cursor: { streamId: control.streamId, revision: control.revision },
    session: { ...raw.session, activeTurnId: display.runningTurnId, terminalState: display.presentation.terminalState } };
}

/** A display-feed transport fixture. Event interpretation remains in imported Main code. */
export function withDisplayFeed<T extends Record<string, any>>(bridge: T, bind?: (emit: (event: any) => void) => void, bindExit?: (emit: (event: any) => void) => void): T {
  const snapshots = new Map<string, any>();
  const subscriptions = new Map<string, { sessionId: string; ready: boolean; frames: any[] }>();
  let callback: ((frame: any) => void) | null = null;
  let nextId = 0;
  const publish = (sessionId: string, next: any) => {
    const previous = snapshots.get(sessionId);
    if (!previous) { snapshots.set(sessionId, next); return; }
    snapshots.set(sessionId, next);
    for (const [subscriptionId, subscription] of subscriptions) {
      if (subscription.sessionId !== sessionId) continue;
      const frame = { type: 'delta', subscriptionId, streamId: next.control.streamId, baseRevision: previous.control.revision,
        revision: next.control.revision, control: projectAgentControlView(next.control), session: next.session, displayPatch: createAgentDisplayPatch(previous.display, next.display) };
      if (subscription.ready) callback?.(frame); else subscription.frames.push(frame);
    }
  };
  const emit = (event: any) => {
    const previous = snapshots.get(event.sessionId);
    if (!previous) return;
    event = associateAgentUserMessage(event, previous.control);
    const control = reduceAgentSessionControl(previous.control, { type: 'event.accepted', event });
    const display = projectAgentDisplayControl(reduceContent(previous.display, event), control);
    publish(event.sessionId, { ...previous, events: [...previous.events, event], display, control,
      cursor: { streamId: control.streamId, revision: control.revision }, lastSequence: event.sequence,
      session: { ...previous.session, lastSequence: event.sequence, activeTurnId: display.runningTurnId, terminalState: display.presentation.terminalState } });
  };
  bind?.(emit);
  bindExit?.(({ sessionId, reason }) => {
    const previous = snapshots.get(sessionId);
    if (!previous || reason !== 'provider-exited') return;
    const control = reduceAgentSessionControl(previous.control, { type: 'adapter.exited', adapterGeneration: previous.control.adapterGeneration, reason });
    const display = projectAgentDisplayControl(previous.display, control);
    publish(sessionId, { ...previous, control, display, cursor: { streamId: control.streamId, revision: control.revision }, session: { ...previous.session, activeTurnId: null, terminalState: 'provider-exited' } });
  });
  Object.assign(bridge, {
    attachAgentSession: vi.fn(async ({ sessionId }) => {
      const subscriptionId = `subscription-${++nextId}`;
      subscriptions.set(subscriptionId, { sessionId, ready: false, frames: [] });
      const snapshot = snapshots.get(sessionId);
      return { subscriptionId, snapshot: { ...snapshot, control: projectAgentControlView(snapshot.control) } };
    }),
    acknowledgeAgentSession: vi.fn(async (request) => {
      const subscription = subscriptions.get(request.subscriptionId);
      if (subscription && !subscription.ready) { subscription.ready = true; for (const frame of subscription.frames) callback?.(frame); subscription.frames = []; }
      return { ...request, synchronized: true };
    }),
    detachAgentSession: vi.fn(async ({ subscriptionId }) => { subscriptions.delete(subscriptionId); return { subscriptionId, detached: true }; }),
    readAgentSessionWatermark: vi.fn(async ({ subscriptionId, sessionId }) => ({ subscriptionId, ...snapshots.get(sessionId).cursor, resyncRequired: false })),
    onAgentSessionFrame: vi.fn((listener) => { callback = listener; return () => { callback = null; }; }),
  });
  const wrappers = new Map();
  return new Proxy(bridge, { get(target, key) {
    const value = Reflect.get(target, key);
    if (!['createAgentSession', 'resumeAgentSession', 'openAgentSession', 'startAgentTurn'].includes(String(key)) || typeof value !== 'function') return value;
    if (!wrappers.has(value)) wrappers.set(value, new Proxy(value, { apply(method, receiver, args) {
      if (key === 'startAgentTurn') {
        const request = args[0]; const previous = snapshots.get(request.sessionId);
        if (previous) {
          const operationId = `operation:${request.commandId}`;
          const intent = { prompt: request.prompt, promptMentions: request.promptMentions ?? [], referenceDisplays: [], model: request.model ?? null, effort: request.effort ?? null, mode: request.mode ?? null };
          let control = reduceAgentSessionControl(previous.control, { type: 'command.received', command: { commandId: request.commandId, kind: 'start', status: 'dispatching', userMessageId: `client:${request.commandId}`, intentFingerprint: request.commandId, intent } });
          control = reduceAgentSessionControl(control, { type: 'command.dispatching', commandId: request.commandId, operationId });
          control = reduceAgentSessionControl(control, { type: 'submission.prepared', submission: { commandId: request.commandId, operationId, adapterGeneration: control.adapterGeneration, prompt: request.prompt, promptMentions: [], referenceDisplays: [] }, startedAtMs: Date.now() });
          const display = projectAgentUserSubmission(previous.display, control.commands.find((command:any) => command.commandId === request.commandId));
          publish(request.sessionId, { ...previous, control, display: projectAgentDisplayControl(display, control) });
        }
      }
      return Promise.resolve(Reflect.apply(method, receiver, args)).then(result => {
        const snapshot = result?.snapshot ?? result;
        if (snapshot?.session) snapshots.set(snapshot.session.id, displaySnapshot(snapshot));
        return result?.snapshot ? { ...result, snapshot: snapshots.get(snapshot.session.id) } : snapshot?.session ? snapshots.get(snapshot.session.id) : result;
      }, error => {
        if (key === 'startAgentTurn') {
          const request = args[0]; const previous = snapshots.get(request.sessionId);
          const control = reduceAgentSessionControl(previous.control, {type:'command.rejected',commandId:request.commandId,error:String(error)});
          publish(request.sessionId,{...previous,control,display:projectAgentDisplayControl(previous.display,control)});
        }
        throw error;
      });
    } }));
    return wrappers.get(value);
  } });
}
