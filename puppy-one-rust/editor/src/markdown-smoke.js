// Called only by the native host's feature-gated smoke hook.
export async function checkMarkdown(smoke) {
  const assert=(condition,message)=>{if(!condition)throw new Error(`Markdown smoke: ${message}`);};
  let checkpoint=0; const wait=async predicate=>{checkpoint++; const end=performance.now()+5000;while(!predicate()){if(performance.now()>end)throw new Error('Markdown preview timeout '+checkpoint+': '+JSON.stringify({state:smoke.state(),height:document.querySelector('.cm-content')?.getBoundingClientRect().height,hidden:document.hidden,preview:document.querySelector('.markdown-codemirror-editor')?.dataset}));await new Promise(r=>setTimeout(r,20));}};
  await wait(()=>smoke.state().markdown?.previewReady);
  await document.fonts.ready;
  const before=smoke.state();
  const content=document.querySelector('.markdown-codemirror-editor .cm-content');
  const h=document.querySelector('.cm-md-heading-1');
  assert(h&&parseFloat(getComputedStyle(h).fontSize)>=28,'real rich heading missing');
  assert(document.querySelector('.cm-md-table-widget-wrap'),'product table widget missing');
  const check=document.querySelector('.cm-md-task-checkbox-widget');
  assert(check&&!check.disabled,'editable task checkbox missing');
  check.click();
  await wait(()=>smoke.state().text.includes('- [x]'));
  assert(smoke.state().revision>before.revision,'rich edit did not advance the document');
  assert(smoke.undo(),'rich edit has no undo');
  assert(smoke.state().text===before.text,'undo changed original Markdown bytes');
  window.puppyEditor.receive({kind:'history',id:before.id,direction:'redo'});
  assert(smoke.state().text.includes('- [x]'),'host history redo did not reach Markdown model');
  window.puppyEditor.receive({kind:'host-overlay',inputBlocked:true});
  window.puppyEditor.receive({kind:'history',id:before.id,direction:'undo'});
  assert(smoke.state().text.includes('- [x]'),'modal allowed background history mutation');
  window.puppyEditor.receive({kind:'host-overlay',inputBlocked:false});
  window.puppyEditor.receive({kind:'history',id:'stale-document',direction:'undo'});
  assert(smoke.state().text.includes('- [x]'),'stale history command changed the document');
  window.puppyEditor.receive({kind:'history',id:before.id,direction:'undo'});
  assert(smoke.state().text===before.text,'host history undo changed original bytes');
  smoke.mode(false);
  await wait(()=>document.querySelector('[data-live-preview=false]'));
  assert(document.querySelector('.cm-content')===content,'source toggle rebuilt EditorView');
  smoke.mode(true);
  await wait(()=>smoke.state().markdown.previewReady);
  window.puppyEditor.receive({kind:'theme',dark:false});
  window.puppyEditor.receive({kind:'theme',dark:true});
  assert(document.querySelector('.cm-content')===content,'appearance rebuilt EditorView');
  assert(smoke.state().text===before.text,'presentation changed the document');
  for (const locale of ['zh-Hans','ja','ko','de','fr','es','pt-BR','en']) {
    smoke.locale(locale);
    await wait(()=>document.documentElement.lang===locale&&document.documentElement.dataset.locale===locale);
    assert(document.querySelector('.cm-content')===content,'locale rebuilt EditorView');
    assert(smoke.state().text===before.text,'locale changed Markdown or save baseline');
  }
  content.focus();
  const bold=new KeyboardEvent('keydown',{key:'b',code:'KeyB',metaKey:true,bubbles:true,cancelable:true});
  content.dispatchEvent(bold);
  assert(bold.defaultPrevented,'focused Markdown formatting did not own Cmd+B');
  if(smoke.state().text!==before.text) {assert(smoke.undo(),'formatting has no undo');}
  assert(smoke.state().text===before.text,'format undo changed Markdown');
  // No host bridge, external frames, remote images or network policy widening.
  assert(!window.puppyoneDesktop,'Electron filesystem bridge leaked into the island');
  return true;
}
