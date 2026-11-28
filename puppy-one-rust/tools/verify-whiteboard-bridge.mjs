#!/usr/bin/env node
// Execute the actual product model with the same native IPC adapter bundled
// into Excalidraw. No alternate model or snapshot-only string assertions.
import assert from 'node:assert/strict';
import path from 'node:path';
import {root, productRoot, importProductModule} from './product-bundle.mjs';
const product = await productRoot();
const {ExcalidrawDocumentModel: Model, parseWhiteboard, createWhiteboardBridge} = await importProductModule(product, `
export {ExcalidrawDocumentModel, parseWhiteboard} from './src/shared-ui/editor/viewers/excalidraw/ExcalidrawDocumentModel';
export {createWhiteboardBridge} from ${JSON.stringify(path.join(root,'tools/native-whiteboard-bridge.ts'))};
`);
const blank=JSON.stringify({type:'excalidraw',version:2,elements:[],appState:{},files:{}});
const changed=JSON.stringify({...JSON.parse(blank),appState:{viewBackgroundColor:'#ff0000'}});
const checks=[];
function fixture(text=blank,canEdit=true) {
  const messages=[];
  const bridge=createWhiteboardBridge({text,canEdit,generation:5}, m=>messages.push(m));
  const model=new Model(text);const detach=bridge.source.attachSource(model.retainedSource);
  function accept(text,generation=model.getGeneration()) {
    const accepted=model.acceptScene(text,generation);
    if(accepted)bridge.source.reportRevision({origin:'local-edit'});
    return accepted;
  }
  return {messages,bridge,model,detach,accept};
}
{
 const original=`\n${blank}\n`;const f=fixture(original);const before=f.model.readSnapshot();
 f.bridge.ready();assert.deepEqual(f.messages.pop(),{type:'ready',generation:5});
 assert.equal(f.accept(blank),false);assert.equal(f.accept(blank),false);
 f.bridge.source.reportRevision({origin:'model-initialization'});
 assert.equal(f.model.readSnapshot(),before);assert.equal(f.messages.length,0);
 assert.equal(f.accept(changed),true);assert.deepEqual(f.messages,[{type:'content',generation:5,text:changed}]);
 f.bridge.source.reportRevision({origin:'local-edit'});assert.equal(f.messages.length,1);
 f.detach();assert.equal(f.accept(blank),false);assert.equal(f.model.readSnapshot().content,changed);
 checks.push('original-bytes-semantic-edit-detach');
}
{
 const f=fixture();f.accept(blank);f.accept(changed);const queued=f.messages.pop();
 // A model subscriber can synchronously report while replaceContent executes.
 f.model.subscribe(()=>f.bridge.source.reportRevision({origin:'local-edit'}));
 f.bridge.reset(blank,6);assert.equal(f.messages.length,0);assert.equal(f.model.getGeneration(),1);
 assert.equal(f.accept(changed,0),false);assert.equal(f.accept(blank,1),false);
 assert.equal(f.model.readSnapshot().content,blank);assert.equal(f.accept(changed,1),true);
 assert.equal(queued.generation,5);assert.deepEqual(f.messages,[{type:'content',generation:6,text:changed}]);
 checks.push('external-reset-and-stale-scene');
}
for(const [index,invalid] of ['', '{', '{}', '{"type":"excalidraw","version":99,"elements":[]}', '{"type":"excalidraw","version":2,"elements":[null]}'].entries()) {
 const f=fixture(invalid);assert.equal(f.model.getScene(),null);assert.equal(f.accept(blank),false);
 assert.equal(f.model.readSnapshot().content,invalid);assert.deepEqual(f.messages,[]);
 f.bridge.reset(blank,6);assert.equal(f.accept(blank),false);assert.equal(f.accept(changed),true);
 assert.equal(f.messages[0].generation,6);checks.push(`invalid-scene-${index}-source-repair`);
}
{
 const data={...JSON.parse(blank),elements:[{id:'image',type:'image',x:0,y:0,width:20,height:20,fileId:'file',customData:{note:'keep'}}],files:{file:{id:'file',mimeType:'image/png',dataURL:'data:image/png;base64,AAAA',created:1}}};
 const text=JSON.stringify(data);const f=fixture(text);assert.deepEqual(parseWhiteboard(text),data);f.accept(text);
 const edit=JSON.stringify({...data,appState:{viewBackgroundColor:'#ff0000'}});assert.equal(f.accept(edit),true);
 const saved=JSON.parse(f.messages[0].text);assert.deepEqual(saved.elements,data.elements);assert.deepEqual(saved.files,data.files);
 checks.push('embedded-image-properties');
}
{
 const f=fixture(blank,false);assert.equal(f.accept(changed),false);assert.deepEqual(f.messages,[]);
 f.bridge.setEnabled(true,6);f.accept(blank);f.accept(changed);assert.equal(f.messages[0].generation,6);
 f.bridge.setEnabled(false,7);assert.equal(f.accept(blank),false);f.bridge.source.reportRevision({origin:'local-edit'});assert.equal(f.messages.length,1);
 f.bridge.setEnabled(true,8);assert.equal(f.accept(blank),true);assert.equal(f.messages[1].generation,8);
 f.bridge.link('notes/image.md');assert.deepEqual(f.messages[2],{type:'link',generation:8,link:'notes/image.md'});
 const replacement=new Model(blank);const detach=f.bridge.source.attachSource(replacement);
 f.detach();assert.equal(f.model.acceptScene(changed,f.model.getGeneration()),false);
 assert.equal(replacement.acceptScene(blank,0),false);assert.equal(replacement.acceptScene(changed,0),true);
 f.bridge.source.reportRevision({origin:'local-edit'});assert.equal(f.messages.at(-1).text,changed);
 const detachAgain=f.bridge.source.attachSource(replacement);
 detach();assert.equal(replacement.acceptScene(blank,0),true);
 detachAgain();assert.equal(replacement.acceptScene(changed,0),false);checks.push('read-only-owner-replacement-links');
}
console.log(JSON.stringify({passed:true,checks}));
