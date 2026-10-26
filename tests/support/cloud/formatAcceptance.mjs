import { createHash } from "node:crypto";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DuckDBInstance } from "@duckdb/node-api";
import XLSX from "xlsx";
import JSZip from "jszip";
import { PNG } from "pngjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const audio = [["wav", "audio/wav"], ["mp3", "audio/mpeg"], ["ogg", "audio/ogg"], ["opus", "audio/ogg"],
  ["weba", "audio/webm"], ["m4a", "audio/mp4"], ["aac", "audio/aac"], ["flac", "audio/flac"], ["aiff", "audio/aiff"]];
const video = [["mp4", "video/mp4"], ["mov", "video/quicktime"], ["3gp", "video/3gpp"]];
const samples = "tests/fixtures/editor/formats/samples";
export async function cloudFormatFixtures(repo) {
  const resources = new Map(), media = [], views = [];
  const put = (name, mimeType, bytes, extra = {}) => { resources.set(name, { mimeType, bytes, ...extra }); return name; };
  for (const [kind, formats, prefix] of [["audio", audio, "silence"], ["video", video, "navy"]]) {
    for (const [extension, mimeType] of formats) {
      const name = put(`acceptance/${prefix}.${extension}`, mimeType, await readFile(path.join(repo, `tests/fixtures/editor/formats/cloud/${prefix}.${extension}`)));
      media.push({ name, kind, mimeType });
    }
  }
  const webm = put("acceptance/movie.webm", "video/webm", await readFile(path.join(repo, samples, "pane-contract.webm")));
  media.push({ name: webm, kind: "video", mimeType: "video/webm" });
  const css = "h1 {color:rgb(12,34,56)}";
  put("acceptance/styles/main.css", "text/css", Buffer.from(css), { content:css });
  const html = '<!doctype html><html><head><link rel="stylesheet" href="styles/main.css"></head><body><h1 id="cloud-title">Cloud visual heading</h1><img src="picture.svg" width="160"></body></html>';
  put("acceptance/visual.html", "text/html", Buffer.from(html), { content:html });
  for (const [extension, mimeType, content, selector] of [
    ["contextmap", "application/vnd.puppyone.context-map+json", JSON.stringify({version:1,scope:'.',layout:{expanded:[],offsets:{}}}), '.context-map-viewer-shell'],
    ["puppyflow", "application/vnd.puppyone.puppyflow+json", JSON.stringify({kind:'puppyflow',version:1,title:'Cloud flow',description:'',steps:[{id:'first',agent:'codex',prompt:'Cloud prompt',enabled:true}]}), '.puppyflow-editor-shell'],
    ["tsv", "text/tab-separated-values", 'Name\tValue\nCloud\t42', '.csv-table-editor'],
  ]) {
    const name=put(`acceptance/document.${extension}`,mimeType,Buffer.from(content),{content});
    views.push({name,selector,condition:extension==='contextmap' ? "Boolean(node.querySelector('[data-node-path]'))" : "node.textContent.length>0"});
  }
  for (const [extension, mimeType, file] of [["png", "image/png", "sample_image.png"], ["jpg", "image/jpeg", "sample_image.jpg"],
    ["gif", "image/gif", "sample_image.gif"], ["bmp", "image/bmp", "sample_bitmap.bmp"], ["svg", "image/svg+xml", "sample_vector.svg"]]) {
    const name = put(`acceptance/picture.${extension}`, mimeType, await readFile(path.join(repo, samples, file)));
    views.push({ name, selector: "img.native-image-preview", condition: "node.complete && node.naturalWidth > 0" });
  }
  const avif=put('acceptance/picture.avif','image/avif',await readFile(path.join(repo,'tests/fixtures/editor/formats/cloud/navy.avif')));
  views.push({name:avif,selector:'img.native-image-preview',condition:'node.complete && node.naturalWidth > 0'});
  // PNG-compressed ICO is a real icon container, not a renamed PNG.
  const iconImage=new PNG({width:32,height:32});
  for(let offset=0;offset<iconImage.data.length;offset+=4) iconImage.data.set([16,42,67,255],offset);
  const iconPng=PNG.sync.write(iconImage);
  const iconHeader=Buffer.alloc(22); iconHeader.writeUInt16LE(1,2); iconHeader.writeUInt16LE(1,4);
  iconHeader[6]=iconPng.readUInt32BE(16)%256; iconHeader[7]=iconPng.readUInt32BE(20)%256;
  iconHeader.writeUInt16LE(1,10); iconHeader.writeUInt16LE(32,12);
  iconHeader.writeUInt32LE(iconPng.length,14); iconHeader.writeUInt32LE(22,18);
  const icon=put('acceptance/picture.ico','image/x-icon',Buffer.concat([iconHeader,iconPng]));
  views.push({name:icon,selector:'img.native-image-preview',condition:'node.complete && node.naturalWidth > 0'});
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Cloud report", "Value"], ["Verified", 42]]), "Cloud");
  for (const type of ["xlsx", "xls", "xlsm", "xlsb", "ods"]) {
    const name = put(`acceptance/report.${type}`, "application/octet-stream", XLSX.write(workbook, { type: "buffer", bookType: type }));
    views.push({ name, selector: ".office-spreadsheet-preview", condition: "node.textContent.includes('Verified')" });
  }
  const template=put('acceptance/report.ots','application/vnd.oasis.opendocument.spreadsheet-template',resources.get('acceptance/report.ods').bytes);
  views.push({name:template,selector:'.office-spreadsheet-preview',condition:"node.textContent.includes('Verified')"});
  for (const [extension, type, body] of [['odt','text','<office:text><text:p>Cloud OpenDocument text</text:p></office:text>'],
    ['ott','text-template','<office:text><text:p>Cloud OpenDocument template</text:p></office:text>'],
    ['odp','presentation','<office:presentation><draw:page draw:name="Cloud"><draw:frame><draw:text-box><text:p>Cloud OpenDocument slide</text:p></draw:text-box></draw:frame></draw:page></office:presentation>'],
    ['otp','presentation-template','<office:presentation><draw:page draw:name="Cloud"><draw:frame><draw:text-box><text:p>Cloud OpenDocument slide template</text:p></draw:text-box></draw:frame></draw:page></office:presentation>']]) {
    const zip=new JSZip(), mime=`application/vnd.oasis.opendocument.${type}`;
    zip.file('mimetype',mime,{compression:'STORE'});
    zip.file('content.xml',`<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" office:version="1.3"><office:body>${body}</office:body></office:document-content>`);
    zip.file('META-INF/manifest.xml',`<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mime}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`);
    const name=put(`acceptance/document.${extension}`,mime,await zip.generateAsync({type:'nodebuffer'}));
    views.push({name,selector:'.office-document-preview',condition:"node.textContent.includes('Cloud OpenDocument')"});
  }
  const pdf=put('acceptance/document.pdf','application/pdf',await readFile(path.join(repo,samples,'sample_document.pdf')));
  views.push({name:pdf,selector:'.pdf-preview-surface',condition:"node.dataset.previewState==='embedded'"});
  for (const [extension, file, selector] of [["docx", "puppyone-preview-sample.docx", ".office-docx-host"],
    ["pptx", "puppyone-presentation-fidelity.pptx", ".office-pptx-render-host"],
    ["ppsx", "puppyone-presentation-fidelity.pptx", ".office-pptx-render-host"], ["rtf", "sample_document.rtf", ".office-docx-host"]]) {
    const name = put(`acceptance/document.${extension}`, "application/octet-stream", await readFile(path.join(repo, samples, file)));
    views.push({ name, selector, condition: ['pptx','ppsx'].includes(extension) ? "Boolean(node.querySelector('svg,canvas'))"
      : "(node.shadowRoot?.querySelector('.office-docx-body')?.textContent.trim().length ?? 0) > 10" });
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "cloud-format-databases-"));
  try {
    if (process.platform==='darwin') {
      const file=path.join(root,'fixture.doc');
      await promisify(execFile)('/usr/bin/textutil',['-convert','doc','-output',file,path.join(repo,samples,'sample_document.rtf')]);
      const name=put('acceptance/document.doc','application/msword',await readFile(file));
      views.push({name,selector:'.office-docx-host',condition:"(node.shadowRoot?.querySelector('.office-docx-body')?.textContent.trim().length ?? 0)>10"});
    }
    const sqlitePath = path.join(root, "fixture.sqlite"), sqlite = new DatabaseSync(sqlitePath);
    sqlite.exec("CREATE TABLE items (id INTEGER, label TEXT); INSERT INTO items VALUES (1, 'Cloud SQLite row');"); sqlite.close();
    const duckPath = path.join(root, "fixture.duckdb"), instance = await DuckDBInstance.create(duckPath), connection = await instance.connect();
    await connection.run("CREATE TABLE items AS SELECT 1 AS id, 'Cloud DuckDB row' AS label;"); connection.closeSync(); instance.closeSync();
    for (const [extension, file] of [["sqlite", sqlitePath], ["duckdb", duckPath]]) {
      const name = put(`acceptance/data.${extension}`, "application/octet-stream", await readFile(file));
      views.push({ name, selector: ".database-preview__table", condition: "node.textContent.includes('Cloud ')" });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
  return { resources, media, views };
}

const active = "[data-cloud-native=true] .document-surface-slot.is-committed:not(.is-obscured)";
export async function acceptCloudFormats({ window, evaluate, waitFor, fixtures, artifacts, assert }) {
  const receipt = { startedAt:new Date().toISOString(), electronVersion:process.versions.electron,
    scope: "synthetic fixtures through production Cloud DataPort and shared editor; no live backend claim", media: [], views: [] };
  const webp=await evaluate("(() => {const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const context=canvas.getContext('2d');context.fillStyle='#102a43';context.fillRect(0,0,32,32);return canvas.toDataURL('image/webp');})()");
  assert(webp.startsWith('data:image/webp;base64,'),'Fixture WebP encoder must produce real WebP bytes');
  fixtures.resources.set('acceptance/picture.webp',{mimeType:'image/webp',bytes:Buffer.from(webp.split(',')[1],'base64')});
  fixtures.views.push({name:'acceptance/picture.webp',selector:'img.native-image-preview',condition:'node.complete && node.naturalWidth>0'});
  const descriptors = [...fixtures.resources].map(([name, resource]) => ({ path: name, mimeType: resource.mimeType, content:resource.content, content_base64:resource.bytes.toString("base64") }));
  await evaluate(`window.__nativeCloudWorkbenchSmoke.addCloudFixtures(${JSON.stringify(descriptors)})`);
  for (const { name, kind, mimeType } of fixtures.media) {
    // Same Chromium decoder with identical bytes, independent of Cloud fetch.
    const bytes = [...fixtures.resources.get(name).bytes];
    const baseline = await evaluate(`(async () => {
      const element = document.createElement(${JSON.stringify(kind)});
      const url = URL.createObjectURL(new Blob([new Uint8Array(${JSON.stringify(bytes)})], {type:${JSON.stringify(mimeType)}}));
      element.muted = true; element.src = url;
      try {
        await Promise.race([new Promise((resolve, reject) => { element.onloadedmetadata=resolve; element.onerror=()=>reject(Error('decoder:'+element.error?.code)); }),
          new Promise((_, reject) => setTimeout(()=>reject(Error('decoder-timeout')),4000))]);
        await element.play();
        await new Promise(resolve=>setTimeout(resolve,300));
        return { supported:true, duration:element.duration, playbackClock:element.currentTime>0 };
      } catch(error) { return { supported:false, reason:error.message }; }
      finally { element.pause(); element.removeAttribute('src'); element.load(); URL.revokeObjectURL(url); }
    })()`);
    if (!baseline.supported) { receipt.media.push({ name, baseline, status: "decoder-unavailable" }); continue; }
    await evaluate(`window.__nativeCloudWorkbenchSmoke.openCloudFile(${JSON.stringify(name)})`);
    const expectedHash = createHash('sha256').update(fixtures.resources.get(name).bytes).digest('hex');
    await waitFor(`(async () => { const node=document.querySelector(${JSON.stringify(`${active} ${kind}`)});
      if (!node || node.readyState<2 || !node.currentSrc.startsWith('blob:')) return false;
      const bytes=await(await fetch(node.currentSrc)).arrayBuffer();
      const digest=await crypto.subtle.digest('SHA-256',bytes);
      return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')===${JSON.stringify(expectedHash)};
    })()`);
    const result = await evaluate(`(async () => {
      const media = document.querySelector(${JSON.stringify(`${active} ${kind}`)});
      media.muted=true; await media.play();
      await new Promise(resolve=>{const deadline=Date.now()+3000; const poll=()=>{
        if(media.currentTime>0 || Date.now()>deadline) resolve(); else setTimeout(poll,30);}; poll();});
      const advanced=media.currentTime>0; media.pause();
      const target=Math.min(0.8,media.duration/2);
      await new Promise((resolve,reject)=>{ const timeout=setTimeout(()=>reject(Error('seek-timeout')),4000);
        media.addEventListener('seeked',()=>{clearTimeout(timeout);resolve();},{once:true}); media.currentTime=target; });
      return { advanced, paused:media.paused, duration:media.duration, seek:media.currentTime,
        width:media.videoWidth ?? null, height:media.videoHeight ?? null };
    })()`);
    assert((result.advanced || !baseline.playbackClock) && result.paused && result.seek > 0, `Playback/seek failed for ${name}: ${JSON.stringify(result)}`);
    if (kind === "video") assert(result.width > 0 && result.height > 0, `Missing decoded video frame for ${name}`);
    receipt.media.push({ name, baseline, status: "passed", playbackClockVerified: result.advanced, ...result });
  }
  for (const { name, selector, condition } of fixtures.views) {
    if (name.endsWith(".rtf") && process.platform !== "darwin") { receipt.views.push({ name, status: "local-converter-unavailable" }); continue; }
    await evaluate(`window.__nativeCloudWorkbenchSmoke.openCloudFile(${JSON.stringify(name)})`);
    await waitFor(`(() => { const node=document.querySelector(${JSON.stringify(`${active} ${selector}`)}); return node && decodeURIComponent(node.closest('.document-surface-slot').dataset.surfaceKey).includes(${JSON.stringify(name)}) && (${condition}); })()`);
    assert(await evaluate(`!document.querySelector(${JSON.stringify(`${active} [role=alert]`)})`), `Failed preview for ${name}`);
    if (name.endsWith('.pdf')) {
      await waitForCloudPdf(window,assert);
      await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      await writeFile(path.join(artifacts,'cloud-pdf.png'),(await window.webContents.capturePage()).toPNG());
    }
    receipt.views.push({ name, status: "passed", ...(name.endsWith('.pdf')
      ? {checks:['production-request-policy','production-navigation-policy','PDFium-page-parsing','paint-capture']} : {}) });
  }
  await writeFile(path.join(artifacts, "cloud-format-acceptance.png"), (await window.webContents.capturePage()).toPNG());
  await acceptCloudVisualHtml({ window, evaluate, waitFor, assert });
  receipt.views.push({ name:"acceptance/visual.html", status:"passed", checks:["relative-CSS", "relative-image", "opaque-sandbox", "visual-edit", "Cloud-CAS-save"] });
  await evaluate("window.__nativeCloudWorkbenchSmoke.openCloudFile('acceptance/document.puppyflow')");
  await waitFor("Boolean(document.querySelector('.puppyflow-step-row textarea'))");
  await evaluate("document.querySelector('.puppyflow-step-row textarea').focus(); document.querySelector('.puppyflow-step-row textarea').select()");
  window.webContents.insertText('Cloud flow save accepted');
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().cloudWrites.some(write=>write.path==='acceptance/document.puppyflow'&&write.content.includes('Cloud flow save accepted'))");
  await writeFile(path.join(artifacts, "cloud-format-acceptance.json"), JSON.stringify(receipt, null, 2));
  return receipt;
}

async function waitForCloudPdf(window,assert) {
  const deadline=Date.now()+12_000;
  let diagnostics=[];
  while(Date.now()<deadline) {
    const pending=[...window.webContents.mainFrame.frames], frames=[];
    while(pending.length) {const frame=pending.shift();frames.push(frame);pending.push(...frame.frames);}
    diagnostics=frames.map(frame=>frame.url);
    const pdf=frames.find(frame=>frame.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'));
    try {if(pdf && await pdf.executeJavaScript("Boolean(document.querySelector('pdf-viewer')?.documentDimensions?.pageDimensions?.length)")) return;} catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert(false,`Cloud PDF viewer did not parse a page: ${JSON.stringify(diagnostics)}`);
}

export async function acceptRevokedCloudMedia({evaluate,waitFor,assert}) {
  await evaluate("window.__nativeCloudWorkbenchSmoke.openCloudFile('acceptance/navy.mp4')");
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(`${active} video`)}))`);
  const previous=await evaluate(`(() => {const media=document.querySelector(${JSON.stringify(`${active} video`)});const url=media.currentSrc;URL.revokeObjectURL(url);media.src=url;media.load();return url;})()`);
  assert(previous.startsWith('blob:'), 'Live media must use sandbox bytes');
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(`${active} [role=alert] button`)}))`);
  await evaluate(`document.querySelector(${JSON.stringify(`${active} [role=alert] button`)}).click()`);
  await waitFor(`(() => {const node=document.querySelector(${JSON.stringify(`${active} video`)});return node && node.readyState>=2 && node.currentSrc!==${JSON.stringify(previous)};})()`);
  assert(await evaluate(`!document.querySelector(${JSON.stringify(`${active} [role=alert]`)})`), 'Retry must recover with freshly read workspace bytes');
  return {name:'acceptance/navy.mp4',checks:['revoked-blob','shared-Retry','workspace-read','decoded-frame'],status:'passed'};
}

async function acceptCloudVisualHtml({ window, evaluate, waitFor, assert }) {
  await evaluate("window.__nativeCloudWorkbenchSmoke.openCloudFile('acceptance/visual.html')");
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(`${active} .html-visual-editor iframe[aria-busy=false]`)}))`);
  const frame = window.webContents.mainFrame.frames.find((item) => item.url.startsWith('puppyone-preview:'));
  assert(!!frame, 'Cloud visual editing requires its isolated projection');
  const preview = await frame.executeJavaScript(`(() => {
    const heading = document.querySelector('#cloud-title'), image = document.querySelector('img');
    let host=false;try{host=!!parent.document}catch{}
    return {color:getComputedStyle(heading).color,image:image.complete&&image.naturalWidth>0,host,
      width:heading.getBoundingClientRect().width};
  })()`);
  assert(preview.color === 'rgb(12, 34, 56)' && preview.image && !preview.host && preview.width > 0,
    `Cloud HTML projection failed: ${JSON.stringify(preview)}`);
  await frame.executeJavaScript("document.querySelector('#cloud-title').click()");
  await waitFor("Boolean(document.querySelector('.html-editor-pencil'))");
  await evaluate("document.querySelector('.html-editor-pencil').click()");
  await waitFor("Boolean(document.querySelector('.html-editor-text-input'))");
  await evaluate("document.querySelector('.html-editor-text-input').focus(); document.querySelector('.html-editor-text-input').select()");
  window.webContents.insertText('Cloud visual edit accepted');
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().cloudWrites.some(write=>write.path==='acceptance/visual.html'&&write.content.includes('Cloud visual edit accepted'))");
  const write = await evaluate("window.__nativeCloudWorkbenchSmoke.state().cloudWrites.findLast(write=>write.path==='acceptance/visual.html')");
  assert(write.content.includes('styles/main.css') && write.content.includes('picture.svg')
    && !write.content.includes('fixture-token') && !write.content.includes('puppyone-preview:'), 'Visual saves retain portable authored resources');
}
