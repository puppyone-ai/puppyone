import { describe, expect, it } from 'vitest';
import { AgentSessionActor } from '../electron/main/agent/domain/agent-session-actor.mjs';
import { normalizeCodexNotification } from '../electron/main/agent/runtimes/codex/codex-app-server-adapter.mjs';
import { createClaudeEventState, normalizeClaudeMessage, normalizeClaudeHistory } from '../electron/main/agent/runtimes/claude/claude-events.mjs';
import { createPiEventState, normalizePiRpcEvent, normalizePiHistory } from '../electron/main/agent/runtimes/pi/pi-event-normalizer.mjs';
import { createAgentTurnQueue } from '../electron/main/agent/application/turn/agent-turn-queue.mjs';
import { applyAgentDisplayPatch } from '../shared/agent-contract/display-state.mjs';
import { assertAgentDisplay, assertAgentDisplayPatch } from '../shared/agent-contract/display-schema.mjs';

const event = (actor, value, runtimeId='codex') => actor.appendEvent({sessionId:'product-session',runtimeId,providerSessionId:'native-session',event:value});
function command(actor, id='command-1', status='dispatching') {
  actor.dispatch({type:'command.received',command:{commandId:id,kind:'start',status,operationId:`operation-${id}`,intentFingerprint:id,userMessageId:`client-${id}`,intent:{prompt:'你好',referenceDisplays:[],promptMentions:[],model:null,effort:null,mode:null}}});
}
function echo(actor, id='native-user', clientId='client-command-1') {
  const raw={method:'item/completed',params:{threadId:'native-session',turnId:'turn-1',item:{type:'userMessage',id,clientId,content:[{type:'text',text:'你好\nProvider compiled context',text_elements:[]}]}}};
  for (const value of normalizeCodexNotification(raw)) event(actor,value);
}

describe('Main-owned Agent display contract across native adapters',()=>{
  it.each(['start-first','echo-first'])('keeps distinct client/native identities as one immutable input (%s)',order=>{
    const actor=new AgentSessionActor(); command(actor);
    const start=()=>event(actor,{type:'turn.started',turnId:'turn-1',payload:{prompt:'你好',userMessageId:'client-command-1'}});
    if(order==='start-first'){start();echo(actor);}else{echo(actor);start();}
    echo(actor);
    expect(actor.display.messages.filter(m=>m.role==='user')).toEqual([expect.objectContaining({id:'user:client-command-1',itemId:'native-user',text:'你好',submissionId:'command-1'})]);
    expect(actor.display.parts.filter(p=>p.kind==='user')).toHaveLength(1);
    expect(assertAgentDisplay(actor.snapshot().display)).toBe(actor.display);
  });
  it('preserves admitted cross-root reference labels through native echo and display patches',()=>{
    const actor=new AgentSessionActor();
    const reference={id:'reference-other-root',kind:'workspace-file',displayName:'README.md',relativePath:'README.md',workspaceName:'Other project'};
    actor.dispatch({type:'command.received',command:{commandId:'command-1',kind:'start',operationId:'op',intentFingerprint:'input',userMessageId:'client-command-1',intent:{prompt:'你好',referenceDisplays:[reference],promptMentions:[],model:null,effort:null,mode:null}}});
    event(actor,{type:'turn.started',turnId:'turn-1',payload:{userMessageId:'client-command-1'}}); echo(actor);
    expect(actor.display.messages[0].references).toEqual([reference]);
    expect(actor.display.parts.find(part=>part.kind==='user').references).toEqual([reference]);
  });
  it('preserves distinct submissions with identical text and same-turn native follow-ups',()=>{
    const actor=new AgentSessionActor();command(actor);echo(actor);
    command(actor,'command-2');echo(actor,'native-user-2','client-command-2');
    echo(actor,'native-followup',null);
    expect(actor.display.messages.filter(m=>m.role==='user')).toHaveLength(3);
  });
  it('settles an upstream retry after a Claude success without changing local connectivity',()=>{
    const actor=new AgentSessionActor();actor.dispatch({type:'adapter.attached'});
    event(actor,{type:'turn.started',turnId:'turn-1',payload:{prompt:'Hello'}},'claude');
    const state=createClaudeEventState({turnId:'turn-1'});
    for(const raw of [
      {type:'system',subtype:'api_retry',attempt:1,max_retries:3,error:'server_error'},
      {type:'assistant',message:{id:'answer',content:[{type:'text',text:'Done'}]}},
      {type:'result',subtype:'success',result:'Done',is_error:false}
    ])for(const value of normalizeClaudeMessage(raw,state))event(actor,value,'claude');
    expect(actor.control.connection.status).toBe('connected');
    expect(actor.control.execution.nativeOutcome).toBe('completed');
    expect(actor.control.recoveries).toEqual([]);
    expect(actor.display.connectionStatus).toBeNull();
  });
  it('dispatches a queued Pi input after failed retries settle the preceding turn',async()=>{
    const actor=new AgentSessionActor();actor.dispatch({type:'adapter.attached'});
    event(actor,{type:'turn.started',turnId:'turn-1',payload:{prompt:'First'}},'pi');
    command(actor,'next','queued');
    const calls=[];
    const session={actor,id:'session',ownerId:1,workspaceRoot:'/workspace',providerExited:false};
    const queue=createAgentTurnQueue({executeStart:async()=>{calls.push('next');actor.dispatch({type:'command.accepted',commandId:'next',operationId:'operation-next'});}});
    queue.enqueue({session,commandId:'next',operationId:'operation-next',request:{}});
    const state=createPiEventState({turnId:'turn-1',providerSessionId:'native-session'});
    for(const raw of [{type:'auto_retry_start',attempt:1,maxAttempts:3},{type:'auto_retry_end',success:false,finalError:'Retry exhausted'},{type:'agent_settled'}]){
      for(const value of normalizePiRpcEvent(raw,state))event(actor,value,'pi');
    }
    await new Promise(resolve=>setImmediate(resolve));
    expect(calls).toEqual(['next']);expect(actor.control.queue).toEqual([]);
    expect(actor.display.connectionStatus).toBeNull();
  });
  it('does not reopen recovery presentation for an uncorrelated retry after completion',()=>{
    const actor=new AgentSessionActor(); actor.dispatch({type:'adapter.attached'});
    event(actor,{type:'turn.started',turnId:'turn-1',payload:{}});
    event(actor,{type:'turn.completed',turnId:'turn-1',payload:{}});
    event(actor,{type:'provider.connection.updated',payload:{state:'reconnecting',message:'Late retry'}});
    expect(actor.display.connectionStatus).toBeNull();
    expect(actor.control.recoveries).toEqual([]);
  });
  it('keeps a transport recovery separate from a completed upstream turn',()=>{
    const actor=new AgentSessionActor();actor.dispatch({type:'adapter.attached'});
    event(actor,{type:'turn.started',turnId:'turn-1',payload:{}});
    event(actor,{type:'provider.connection.updated',payload:{state:'reconnecting',scope:'transport',recoveryId:'connection-recovery'}});
    event(actor,{type:'turn.completed',turnId:'turn-1',payload:{}});
    expect(actor.control.connection.status).toBe('recovering');
    expect(actor.display.connectionStatus).not.toBeNull();
  });
  it('preserves supported Claude assistant errors as native diagnostics',()=>{
    const events=normalizeClaudeMessage({type:'assistant',error:'authentication_failed',message:{id:'error-message',content:[{type:'text',text:'Authentication failed'}]}},createClaudeEventState({turnId:'turn-1'}));
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({type:'provider.error',payload:expect.objectContaining({code:'authentication_failed'})})]));
  });
  it.each([
    ['claude',()=>normalizeClaudeHistory([{type:'user',uuid:'history-user',message:{content:[{type:'text',text:'Hello'}]}}],'native-session')],
    ['pi',()=>normalizePiHistory([{role:'user',content:[{type:'text',text:'Hello'}]}],'native-session')]
  ])('does not invent a successful result from a %s history group',(_,read)=>{
    const actor=new AgentSessionActor();for(const value of read())event(actor,value);
    expect(actor.control.execution.nativeOutcome).toBeNull();
    expect(actor.control.execution.certainty).toBe('unknown');
    expect(actor.display.turns[0].status).toBe('outcome-unknown');
  });
  it('reconstructs the exact committed display from structural patches',()=>{
    const actor=new AgentSessionActor();let replica=structuredClone(actor.display);
    actor.subscribe(commit=>{assertAgentDisplayPatch(commit.displayPatch);replica=applyAgentDisplayPatch(replica,structuredClone(commit.displayPatch));});
    event(actor,{type:'turn.started',turnId:'turn-1',payload:{prompt:'Hello'}});
    event(actor,{type:'assistant.delta',turnId:'turn-1',itemId:'answer',payload:{delta:'x'.repeat(512)}});
    event(actor,{type:'assistant.delta',turnId:'turn-1',itemId:'answer',payload:{delta:'tail'}});
    event(actor,{type:'assistant.completed',turnId:'turn-1',itemId:'answer',payload:{text:'Authoritative replacement'}});
    event(actor,{type:'turn.completed',turnId:'turn-1',payload:{}});
    expect(replica).toEqual(actor.snapshot().display);
  });
  it('publishes reentrant commits in revision order for every subscriber',()=>{
    const actor=new AgentSessionActor();const revisions=[];
    actor.subscribe(commit=>{if(commit.revision===1)actor.dispatch({type:'connection.connecting'});});
    actor.subscribe(commit=>revisions.push(commit.revision));
    actor.dispatch({type:'adapter.attached'});
    expect(revisions).toEqual([1,2]);
  });
});

describe('Agent display failure and request isolation', () => {
  it('tracks two replies independently and admits one effect per native request', async () => {
    const { createServiceHarness, createSender } = await import('./helpers/agentServiceHarness.mjs');
    const harness = createServiceHarness(); const owner = createSender(101);
    const snapshot = await harness.service.createSession(owner, {runtimeId:'codex'}, '/workspace');
    await harness.service.startTurn(owner, {sessionId:snapshot.session.id,prompt:'Run'});
    const adapter = harness.adapters[0]; let finish;
    adapter.resolveApproval.mockImplementationOnce(() => new Promise(resolve => {finish=resolve;}));
    for (const requestId of ['request-a','request-b']) adapter.emit({type:'approval.requested',turnId:'turn-1',payload:{requestId,kind:'command',availableDecisions:['accept','decline']}});
    const request = {sessionId:snapshot.session.id,turnId:'turn-1',requestId:'request-a',decision:'accept',commandId:'reply-a'};
    const pending = harness.service.resolveApproval(owner, request);
    const display = harness.service.replay(owner, {sessionId:snapshot.session.id,afterSequence:0}).display;
    expect(display.approvals.map(entry => [entry.requestId,entry.replyStatus])).toEqual([['request-a','dispatching'],['request-b',null]]);
    expect(() => harness.service.resolveApproval(owner, {...request, commandId:'duplicate-a'})).toThrow(/already being delivered/);
    expect(harness.service.resolveApproval(owner, request)).toMatchObject({commandId:'reply-a'});
    expect(adapter.resolveApproval).toHaveBeenCalledTimes(1);
    finish(); await pending;
    expect(harness.service.resolveApproval(owner,{...request,requestId:'request-b',commandId:'reply-b'})).toMatchObject({requestId:'request-b'});
    await harness.service.closeSession(owner,{sessionId:snapshot.session.id,removePersistence:false});
  });
  it('displays a malformed-item diagnostic, accepts later output and preserves native completion', async () => {
    const { createAgentEventJournal } = await import('../electron/main/agent/application/agent-event-journal.mjs');
    const actor=new AgentSessionActor(); const session={actor,id:'session',runtimeId:'codex',providerSessionId:'native',workspaceRoot:'/workspace',closing:true,activeTurnId:'turn-1'};
    const journal=createAgentEventJournal({sessionCache:{},logger:{warn(){}}});
    journal.emit(session,{type:'turn.started',turnId:'turn-1',payload:{prompt:'Hello'}});
    journal.emit(session,{type:'assistant.delta',turnId:'turn-1',itemId:{invalid:true},payload:{delta:'Bad item'}});
    journal.emit(session,{type:'assistant.completed',turnId:'turn-1',itemId:'answer',payload:{text:'Later valid output'}});
    journal.emit(session,{type:'turn.completed',turnId:'turn-1',payload:{durationMs:'invalid'}});
    expect(actor.display.messages.some(entry=>entry.text==='Later valid output')).toBe(true);
    expect(actor.display.activities.some(entry=>entry.kind==='error')).toBe(true);
    expect(actor.control.execution.nativeOutcome).toBe('completed');
    expect(actor.display.presentation.terminalState).toBe('completed');
  });
  it('settles uncertain tool and assistant presentation without inventing a native outcome',()=>{
    const actor=new AgentSessionActor(); actor.dispatch({type:'adapter.attached'});
    event(actor,{type:'turn.started',turnId:'turn-1',payload:{}});
    event(actor,{type:'assistant.delta',turnId:'turn-1',itemId:'answer',payload:{delta:'Partial'}});
    event(actor,{type:'tool.started',turnId:'turn-1',itemId:'tool',payload:{tool:'Read'}});
    actor.dispatch({type:'recovery.unconfirmed',reason:'connection-lost'});
    expect(actor.display.messages[0].streaming).toBe(false);
    expect(actor.display.activities[0].status).toBe('unknown');
    expect(actor.display.turns[0].status).toBe('outcome-unknown');
    expect(actor.display.parts.some(part=>part.kind==='turn-summary')).toBe(false);
  });
  it('keeps native diagnostic fields across the serialized IPC failure boundary',async()=>{
    const { registerAgentIpcHandlers } = await import('../electron/main/ipc/agent-ipc.mjs');
    const { readAgentOperationFailure } = await import('../shared/agent-contract/operation-error.mjs');
    const failure=Object.assign(new Error('Please sign in'),{code:'AUTH_REQUIRED',runtimeId:'claude',operation:'create',stage:'authentication',status:'unauthenticated',retryable:false,actions:['sign-in'],privateNativeState:'do not expose'});
    const handlers=new Map();
    registerAgentIpcHandlers({ipcMain:{handle:(key,fn)=>handlers.set(key,fn)},agentService:{createSession:async()=>{throw failure;}},authorizeWorkspaceRoot:async()=>'/workspace'});
    const result=await handlers.get('agent:session-create')({sender:{}},{rootPath:'/workspace',runtimeId:'claude'});
    const decoded=readAgentOperationFailure(JSON.parse(JSON.stringify(result)));
    expect(decoded).toMatchObject({code:'AUTH_REQUIRED',runtimeId:'claude',stage:'authentication',actions:['sign-in']});
    expect(decoded).not.toHaveProperty('privateNativeState');
  });
  it('bounds historical turn metadata even when the source provides no renderable parts',async()=>{
    const {boundAgentDisplay}=await import('../electron/main/agent/domain/transcript/display-window.mjs');
    const actor=new AgentSessionActor();
    const display={...actor.display,turns:Array.from({length:2_100},(_,i)=>({id:`empty-${i}`,status:'outcome-unknown',startedAtSequence:i,startedAtMs:null,completedAtSequence:null,durationMs:null,partIds:[]}))};
    const bounded=boundAgentDisplay(display,actor.control);
    expect(bounded.partialHistory).toBe(true);
    expect(bounded.turns.length).toBeLessThan(2_000);
    expect(assertAgentDisplay(bounded)).toBe(bounded);
  });
  it('bounds large content by bytes as well as entry count and keeps the active input',()=>{
    const actor=new AgentSessionActor(); command(actor);
    event(actor,{type:'turn.started',turnId:'turn-1',payload:{prompt:'Hello',userMessageId:'client-command-1'}});
    for(let index=0;index<50;index++) event(actor,{type:'assistant.completed',turnId:'turn-1',itemId:`answer-${index}`,payload:{text:'中'.repeat(60_000)}});
    expect(actor.display.partialHistory).toBe(true);
    expect(actor.display.messages.some(entry=>entry.role==='user')).toBe(true);
    expect(actor.display.messages.at(-1).itemId).toBe('answer-49');
    expect(assertAgentDisplay(actor.display)).toBe(actor.display);
  });
});
