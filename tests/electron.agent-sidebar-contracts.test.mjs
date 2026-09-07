import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { AgentSessionActor } from '../electron/main/agent/domain/agent-session-actor.mjs';
import { CodexAppServerAdapter } from '../electron/main/agent/runtimes/codex/codex-app-server-adapter.mjs';
import { normalizeHistoricalThread } from '../electron/main/agent/runtimes/codex/codex-history-projection.mjs';
import { AcpEventNormalizer } from '../electron/main/agent/protocols/acp/acp-event-normalizer.mjs';
import { normalizeClaudeMessage, createClaudeEventState } from '../electron/main/agent/runtimes/claude/claude-events.mjs';
import { normalizePiRpcEvent, createPiEventState } from '../electron/main/agent/runtimes/pi/pi-event-normalizer.mjs';
import { projectAgentControlView } from '../electron/main/agent/domain/agent-control-view.mjs';
import { assertAgentSessionControlView } from '../shared/agent-contract/schema.mjs';
import { AgentSessionFeed } from '../electron/main/agent/application/session/agent-session-feed.mjs';
import { createAgentSessionRecord } from '../electron/main/agent/domain/agent-session-model.mjs';
import { createServiceHarness, createSender } from './helpers/agentServiceHarness.mjs';

const append = (actor, event) => actor.appendEvent({sessionId:'session',runtimeId:'codex',providerSessionId:'thread',event});
const admit = (actor, id = 'input', prompt = 'Hello', status = 'dispatching') => actor.dispatch({type:'command.received',command:{
  commandId:id, operationId:`operation:${id}`, kind:'start', status, intentFingerprint:`fingerprint:${id}`,
  userMessageId:`client:${id}`, intent:{prompt,promptMentions:[],referenceDisplays:[],model:null,effort:null,mode:null},
}});

describe('Agent sidebar protocol and display invariants', () => {
  it('returns the native confirmed outcome when the real start transaction loses its receipt', async () => {
    const h = createServiceHarness(); const owner = createSender(912);
    try {
      const snapshot = await h.service.createSession(owner,{runtimeId:'codex'},'/workspace');
      h.adapters[0].startTurn.mockImplementationOnce(async ({clientUserMessageId}) => {
        h.adapters[0].emit({type:'turn.started',turnId:'fast',payload:{userMessageId:clientUserMessageId}});
        h.adapters[0].emit({type:'turn.completed',turnId:'fast',payload:{}});
        throw new Error('RPC receipt lost');
      });
      const receipt = await h.service.startTurn(owner,{sessionId:snapshot.session.id,commandId:'once',prompt:'Hello'},'/workspace');
      expect(receipt).toMatchObject({turnId:'fast'});
      const result = h.service.replay(owner,{sessionId:snapshot.session.id,afterSequence:0},'/workspace');
      expect(result.control.execution).toMatchObject({status:'ended',nativeOutcome:'completed'});
      expect(result.display.parts.filter(part=>part.kind==='user')).toHaveLength(1);
      expect(h.adapters[0].startTurn).toHaveBeenCalledTimes(1);
    } finally { await h.service.closeAll(); }
  });

  it('retains and later confirms an ambiguous command instead of evicting or resending it', () => {
    const actor = new AgentSessionActor(); admit(actor);
    actor.dispatch({type:'command.outcome-unknown',commandId:'input'});
    for (let index=0; index<140; index++) { admit(actor,`later-${index}`); actor.dispatch({type:'command.rejected',commandId:`later-${index}`}); }
    expect(actor.control.commands.some(command=>command.commandId==='input')).toBe(true);
    append(actor,{type:'turn.started',turnId:'late-turn',payload:{userMessageId:'client:input'}});
    expect(actor.control.commands.find(command=>command.commandId==='input')).toMatchObject({status:'accepted',targetTurnId:'late-turn'});
    expect(actor.display.parts.filter(part=>part.kind==='user' && part.submissionId==='input')).toHaveLength(1);
  });
  it.each(['queued','dispatching'])('materializes one %s input at admission and joins native identity without another bubble', status => {
    const actor = new AgentSessionActor();
    admit(actor, 'input', 'Hello', status);
    expect(actor.display.parts).toMatchObject([{kind:'user',text:'Hello',submissionId:'input',deliveryStatus:status}]);
    const identity = actor.display.parts[0].id;
    append(actor,{type:'turn.started',turnId:'turn',payload:{submissionId:'input',userMessageId:'client:input',prompt:'Hello'}});
    append(actor,{type:'user.message',turnId:'turn',itemId:'native-user',payload:{clientUserMessageId:'client:input',text:'Compiled harness input'}});
    expect(actor.display.parts.filter(part => part.kind === 'user')).toMatchObject([{id:identity,text:'Hello',turnId:'turn',itemId:'native-user',deliveryStatus:'accepted'}]);
    expect(actor.display.messages).toHaveLength(1);
    expect(actor.control.commands[0].targetTurnId).toBe('turn');
    expect(actor.control.commands[0].intent).toBeUndefined();
  });

  it('preserves same-text inputs and their failed or unknown delivery state without renderer fallback', () => {
    const actor = new AgentSessionActor();
    admit(actor,'first'); admit(actor,'second');
    actor.dispatch({type:'command.rejected',commandId:'first'});
    actor.dispatch({type:'command.outcome-unknown',commandId:'second'});
    expect(actor.display.parts.filter(part => part.kind === 'user').map(part => [part.submissionId,part.deliveryStatus])).toEqual([
      ['first','rejected'],['second','outcome-unknown'],
    ]);
    expect(actor.display.presentation.pendingPrompt).toBeNull();
  });

  it('keeps native completion when the start acknowledgement is lost', () => {
    const actor = new AgentSessionActor(); actor.dispatch({type:'adapter.attached'}); admit(actor);
    const identity = {commandId:'input',operationId:'operation:input',adapterGeneration:1};
    actor.dispatch({type:'submission.prepared',submission:{...identity,prompt:'Hello',promptMentions:[],referenceDisplays:[]}});
    append(actor,{type:'turn.started',turnId:'turn',payload:{}});
    append(actor,{type:'turn.completed',turnId:'turn',payload:{}});
    actor.dispatch({type:'submission.outcome-unknown',...identity,error:'Lost ACK'});
    expect(actor.control.commands[0]).toMatchObject({status:'accepted',targetTurnId:'turn'});
    expect(actor.control.execution).toMatchObject({status:'ended',nativeOutcome:'completed'});
    expect(actor.display.parts.filter(part => part.kind === 'user')).toHaveLength(1);
  });

  it('retains complete answers above 32K and accepts an explicitly shorter final correction', () => {
    const actor = new AgentSessionActor(); const answer = 'x'.repeat(40_000) + 'THE END';
    for (let offset=0; offset<answer.length; offset+=10_000) append(actor,{type:'assistant.delta',turnId:'turn',itemId:'answer',payload:{delta:answer.slice(offset,offset+10_000)}});
    append(actor,{type:'assistant.completed',turnId:'turn',itemId:'answer',payload:{text:answer}});
    expect(actor.display.messages[0]).toMatchObject({text:answer,truncated:false,streaming:false});
    append(actor,{type:'assistant.completed',turnId:'turn',itemId:'answer',payload:{text:'Corrected answer'}});
    expect(actor.display.messages[0].text).toBe('Corrected answer');
  });

  it('does not replace accumulated content with a known incomplete prefix and reports the display limit', () => {
    const actor = new AgentSessionActor(); const answer = 'x'.repeat(40_000);
    append(actor,{type:'assistant.delta',turnId:'turn',itemId:'answer',payload:{delta:answer}});
    append(actor,{type:'assistant.completed',turnId:'turn',itemId:'answer',payload:{text:answer.slice(0,20_000),truncated:true}});
    expect(actor.display.messages[0]).toMatchObject({text:answer,truncated:true});
    append(actor,{type:'assistant.completed',turnId:'turn',itemId:'large',payload:{text:'y'.repeat(200_000)}});
    expect(actor.display.messages.at(-1)).toMatchObject({text:'y'.repeat(128*1024),truncated:true});
  });

  it.each(['claude','pi','acp'])('does not silently clip %s final text in the adapter', provider => {
    const text = 'a'.repeat(40_000) + 'END'; let events;
    if (provider === 'claude') events = normalizeClaudeMessage({type:'assistant',message:{id:'answer',content:[{type:'text',text}]}},createClaudeEventState({turnId:'turn'}));
    if (provider === 'pi') events = normalizePiRpcEvent({type:'message_end',message:{role:'assistant',content:[{type:'text',text}]}},createPiEventState({turnId:'turn'}));
    if (provider === 'acp') { const normalizer = new AcpEventNormalizer({turnId:'turn'}); normalizer.normalize({sessionId:'thread',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}); events = normalizer.completeAssistant('thread'); }
    const actor = new AgentSessionActor(); for (const event of events) append(actor,event);
    expect(actor.display.messages[0].text).toBe(text);
  });

  it('merges ACP partial tool updates, replacements, empty content and terminal metadata by presence', () => {
    const actor = new AgentSessionActor(); const normalizer = new AcpEventNormalizer({turnId:'turn'});
    const update = value => { for (const event of normalizer.normalize({sessionId:'thread',update:{sessionUpdate:'tool_call_update',toolCallId:'tool',...value}})) append(actor,event); };
    const content = text => [{type:'content',content:{type:'text',text}}];
    update({sessionUpdate:'tool_call',kind:'execute',title:'Bash',status:'in_progress',content:content('OLD')});
    update({content:content('NEW')});
    expect(actor.display.activities[0]).toMatchObject({kind:'command',output:'NEW',status:'running'});
    update({status:'failed'});
    expect(actor.display.activities[0]).toMatchObject({kind:'command',output:'NEW',status:'failed'});
    update({content:[]});
    expect(actor.display.activities[0]).toMatchObject({kind:'command',output:'',status:'failed'});
  });

  it('keeps large command histories out of IPC frames so a fresh attachment can continue streaming', () => {
    const actor = new AgentSessionActor();
    for (let index=0; index<75; index++) {
      admit(actor,`input-${index}`,'文'.repeat(40_000));
      actor.dispatch({type:'command.accepted',commandId:`input-${index}`});
    }
    const view = projectAgentControlView(actor.control);
    expect(() => assertAgentSessionControlView(view)).not.toThrow();
    expect(Buffer.byteLength(JSON.stringify(view))).toBeLessThan(100_000);
    const frames = [];
    const session = createAgentSessionRecord({id:'session',workspaceRoot:'/workspace',runtimeId:'codex',ownerId:1,sender:{send:(_channel,frame)=>frames.push(frame),isDestroyed:()=>false}});
    session.actor = actor;
    const feed = new AgentSessionFeed();
    try {
      const receipt = feed.attach(session);
      feed.acknowledge(session,{subscriptionId:receipt.subscriptionId,...receipt.snapshot.cursor});
      append(actor,{type:'assistant.delta',turnId:'turn',itemId:'answer',payload:{delta:'Streaming continues'}});
      expect(frames.map(frame=>frame.type)).toEqual(['delta']);
      expect(frames[0].control.commands.every(command=>!('intent' in command))).toBe(true);
    } finally { feed.releaseAll(); }
  });
  it('does not turn historical replay time into a native Worked duration', () => {
    let now = 1_000_000;
    const actor = new AgentSessionActor({clock:() => now++});
    for (const event of normalizeHistoricalThread({id:'thread',turns:[{
      id:'historical',status:'completed',items:[{id:'answer',type:'agentMessage',text:'An old answer'}],
    }]})) append(actor,event);
    expect(actor.display.turns[0]).toMatchObject({status:'completed',durationMs:null});
    expect(actor.display.parts.some(part => part.kind === 'turn-summary')).toBe(false);
  });

  it('does not reactivate a Codex turn when completion precedes the start receipt', async () => {
    const actor = new AgentSessionActor();
    const connection = new EventEmitter();
    connection.notify = () => {};
    connection.dispose = () => {};
    connection.request = async method => {
      if (method === 'turn/start') {
        connection.emit('notification',{method:'turn/started',params:{threadId:'thread',turnId:'turn'}});
        connection.emit('notification',{method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});
        return {turn:{id:'turn'}};
      }
      return {};
    };
    const adapter = new CodexAppServerAdapter({workspaceRoot:'/workspace',connectionFactory:() => connection,onEvent:event => append(actor,event)});
    try {
      await adapter.connect();
      adapter.threadId = 'thread';
      await expect(adapter.startTurn({prompt:'Hello'})).resolves.toMatchObject({turnId:'turn'});
      expect(actor.control.execution.nativeOutcome).toBe('completed');
      expect(adapter.activeTurnId).toBeNull();
      await expect(adapter.compactSession()).resolves.toBeUndefined();
    } finally { adapter.dispose(); }
  });
});
