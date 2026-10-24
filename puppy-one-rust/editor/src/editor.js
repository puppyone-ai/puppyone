// Content island only. No filesystem API: the product editor pane (chrome,
// pane menu, find, every text Viewer) runs behind an offline CSP; documents
// cross the boundary as token + revision + bounded snapshots.
import {createPane} from './pane.tsx';
import {checkMarkdown} from './markdown-smoke.js';

let pane=null, id=null, revision=0, frozen=false, composing=false, dark=true, livePreview=true, locale='en', scale='medium', dismissPopovers=false, hostBlocked=false, interaction={};
const host=document.querySelector('#editor');
const empty=document.querySelector('#empty');
const overlay=document.querySelector('#desktop-overlay-root');
const post=message=>window.ipc.postMessage(JSON.stringify(message));
const action=action=>{post({type:'action',action});return true;};
const changed=()=>{revision++;post({type:'dirty',id,revision,dirty:pane?pane.dirty():false});};
const scaleName=delta=>delta<0?'small':delta>0?'large':'medium';
function appearance() {
  for (const element of [document.documentElement,document.body,overlay]) element.classList.toggle('dark',dark);
  document.documentElement.dataset.theme=dark?'dark':'light';
}
function setFrozen(value) {pane?.freeze(value);frozen=value;}
function clear() {pane?.destroy();pane=null;id=null;revision=0;host.replaceChildren();empty.hidden=false;}
function open(message) {
  // A round trip without edits in the other provider keeps this pane's
  // history, selection and scroll.
  if(pane&&id===message.id) {
    if(!message.external&&pane.snapshot()===message.text) {
      revision=message.revision??0;pane.baseline(message.baseline??message.text);
      setFrozen(false);post({type:'loaded',id,transfer:message.transfer??null});return;
    }
    if(message.external){revision=message.revision??0;pane.replace(message.text);setFrozen(false);post({type:'loaded',id,transfer:message.transfer??null});return;}
  }
  clear();
  id=message.id;revision=message.revision??0;frozen=false;empty.hidden=true;
  const openingId=id, name=message.name.split('/').pop();
  pane=createPane({parent:host,path:message.name,name,text:message.text,baselineText:message.baseline??message.text,dark,locale,scale,interaction,
    onChange(){if(id===openingId)changed();},
    onReady(){
      if(id!==openingId)return;
      post({type:'loaded',id,transfer:message.transfer??null});
      if(!livePreview)pane.mode(false);
      queueMicrotask(()=>{if(id===openingId&&!frozen&&!hostBlocked)host.querySelector('.cm-content,[data-csv-table-root],[tabindex="0"]')?.focus({preventScroll:true});});
    },
    onError(error){if(id===openingId)post({type:'fault',message:`${error.message} ${(error.stack||'').split('\n').slice(0,4).join(' | ')}`});},
    onAction(name){action(name);}});
}
window.puppyEditor=Object.freeze({receive(message) {
  try { switch(message.kind) {
    case 'open':open(message);break;
    case 'clear':clear();break;
    case 'theme':dark=message.dark;scale=scaleName(message.scale??0);appearance();pane?.typography(scale);pane?.theme(dark);break;
    case 'locale':locale=message.locale;document.documentElement.lang=locale;pane?.locale(locale);break;
    case 'preferences':interaction={...interaction,...message.interaction};pane?.interaction(interaction);break;
    case 'host-overlay':
      dismissPopovers=message.dismissOnPointerDown===true;hostBlocked=message.inputBlocked===true;document.body.inert=hostBlocked;
      // A native modal owns keyboard focus: `inert` alone does not move focus
      // that is already inside the editor in WebKit.
      if(hostBlocked){pane?.closeMenu();if(document.activeElement instanceof HTMLElement&&document.activeElement!==document.body)document.activeElement.blur();}
      break;
    case 'history':
      if(id===message.id&&!frozen&&!hostBlocked&&['undo','redo'].includes(message.direction))pane?.history(message.direction);
      break;
    case 'presentation':if(!frozen){livePreview=message.livePreview;pane?.mode(livePreview);}break;
    case 'snapshot':
      if(!pane||!id){post({type:'fault',message:'No active document for snapshot'});return;}
      if(composing){post({type:'deferred',request:message.request,id});return;}
      if(message.freeze!==false)setFrozen(true);
      post({type:'snapshot',request:message.request,id,revision,text:pane.snapshot()});
      break;
    case 'saved':
      if(pane&&id===message.id&&message.revision<=revision) {
        if(typeof message.text==='string')pane.baseline(message.text);
        else if(revision===message.revision)pane.saved();
        post({type:'dirty',id,revision,dirty:pane.dirty()});
      }
      break;
    case 'thaw':setFrozen(false);break;
  }} catch(error) {post({type:'fault',message:error.message});}
}});
document.addEventListener('keydown',event=>{
  if(hostBlocked||event.defaultPrevented||event.isComposing||(!event.metaKey&&!event.ctrlKey))return;
  const actions={o:'open-folder',b:'toggle-explorer',j:'toggle-right',',':'settings',s:'save',w:'close-file'};
  const name=actions[event.key.toLowerCase()];
  if(name){event.preventDefault();event.stopPropagation();if(!event.repeat)action(name);}
}); // Bubble AFTER editor formatting/search handlers, never before them.
document.addEventListener('focusin',event=>{if(hostBlocked&&event.target instanceof HTMLElement)event.target.blur();},true);
document.addEventListener('pointerdown',()=>{if(dismissPopovers){dismissPopovers=false;action('dismiss-popovers');}},true);
document.addEventListener('contextmenu',event=>{if(!event.defaultPrevented)event.preventDefault();});
document.addEventListener('compositionstart',()=>{composing=true;},true);
document.addEventListener('compositionend',()=>{composing=false;queueMicrotask(()=>{if(id)post({type:'dirty',id,revision,dirty:pane?pane.dirty():false});});},true);
window.addEventListener('error',event=>post({type:'fault',message:event.error?.stack?`${event.message} ${event.error.stack.split('\n').slice(0,4).join(' | ')}`:event.message}));
window.addEventListener('unhandledrejection',event=>post({type:'fault',message:`Unhandled: ${event.reason?.message??event.reason}`}));
appearance();
// This hook only exists in an explicitly feature-gated local smoke build.
if(window.__PUPPY_SMOKE_MODE__===true) {
  window.__puppySmoke=Object.freeze({
    edit(text){if(frozen)throw new Error('Editor frozen');if(!pane)throw new Error('Editor unavailable');pane.edit(text);},
    checkMarkdown(){return checkMarkdown(window.__puppySmoke);},
    undo(){return pane?.history('undo');},
    mode(value){window.puppyEditor.receive({kind:'presentation',livePreview:value});},
    save(){action('save');},
    action,
    locale(value){window.puppyEditor.receive({kind:'locale',locale:value});},
    state(){const s=pane?.state();return {id,revision,text:s?.text??null,dirty:s?.dirty??false,frozen,hostBlocked,viewer:s?.viewer??null,menuItems:s?.menuItems??[],markdown:s?.viewer==='markdown'?s:null};},
  });
}
post({type:'ready'});
