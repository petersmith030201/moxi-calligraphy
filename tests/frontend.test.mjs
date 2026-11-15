// Optional DOM integration. Run Node 24 --experimental-vm-modules.
// jsdom@26.1.0 may be installed separately via MOXI_TEST_DEPS.
// This does not claim real-browser layout, animation pixels or touch QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {setTimeout as delay} from 'node:timers/promises';
const root=fileURLToPath(new URL('../',import.meta.url));
let jsdom;
for(const directory of [process.env.MOXI_TEST_DEPS,fileURLToPath(new URL('../../../work/test-deps/',import.meta.url)),root].filter(Boolean)){
  try{jsdom=createRequire(path.join(directory,'package.json'))('jsdom');break;}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
}
if(!jsdom||typeof vm.SourceTextModule!=='function'){
  test('optional frontend DOM tests',{skip:'Needs jsdom@26.1.0 and --experimental-vm-modules; this is not browser QA.'},()=>{});
}else{
  const html=await readFile(path.join(root,'index.html'),'utf8');
  const css=await readFile(path.join(root,'styles.css'),'utf8');
  const metadata=JSON.parse(await readFile(path.join(root,'data/characters.json'),'utf8'));
  const {JSDOM,VirtualConsole}=jsdom,storageKey='moxi-notebook-v1';
  async function until(predicate,message='Expected UI state was not reached'){
    const deadline=Date.now()+3500;while(Date.now()<deadline){if(predicate())return;await delay(12);}assert.fail(message);
  }
  async function setup(t,{saved,realEngine=false,tickingClock=false}={}){
    const consoleErrors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>consoleErrors.push(error));
    const dom=new JSDOM(html,{url:'https://example.github.io/moxi-calligraphy/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
    const w=dom.window,doc=w.document,downloads=[],calls=[];t.after(()=>w.close());
    const style=doc.createElement('style');style.textContent=css;doc.head.append(style);
    if(tickingClock){const RealDate=w.Date;let clock=RealDate.now();w.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[++clock]));}static now(){return ++clock;}};}
    w.scrollTo=()=>{};w.Blob=Blob;w.URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:local-export';};w.URL.revokeObjectURL=()=>{};
    doc.addEventListener('click',e=>{if(e.target.closest?.('a[download]'))e.preventDefault();});
    w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
    w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
    w.localStorage.setItem('moxi-legacy-learning','preserve me');if(saved)w.localStorage.setItem(storageKey,JSON.stringify(saved));
    w.fetch=async input=>{
      const pathname=new URL(String(input),w.location.href).pathname;calls.push(pathname);let value;
      if(pathname.endsWith('/data/characters.json'))value=metadata;
      else if(pathname.includes('/data/characters/')){
        try{value=JSON.parse(await readFile(path.join(root,'data/characters',decodeURIComponent(pathname.split('/').at(-1))),'utf8'));}catch{return{ok:false,status:404};}
      }else throw Error(`Unexpected network request: ${pathname}`);
      return{ok:true,status:200,json:async()=>w.JSON.parse(JSON.stringify(value))};
    };
    if(realEngine)w.eval(await readFile(path.join(root,'vendor/hanzi-writer.min.js'),'utf8'));
    else w.HanziWriter={create(target,char){doc.getElementById(target).textContent=`SVG reference for ${char}`;return{showCharacter(){},hideCharacter(){},showOutline(){},hideOutline(){},pauseAnimation(){},resumeAnimation(){},animateCharacter(){return Promise.resolve();},animateStroke(){return Promise.resolve();},updateColor(){},cancelQuiz(){}};}};
    const context=dom.getInternalVMContext(),cache=new Map();
    async function load(filename){
      if(cache.has(filename))return cache.get(filename);
      const module=new vm.SourceTextModule(await readFile(filename,'utf8'),{context,identifier:pathToFileURL(filename).href,initializeImportMeta(meta){meta.url=pathToFileURL(filename).href;}});cache.set(filename,module);
      await module.link((specifier,parent)=>load(fileURLToPath(new URL(specifier,parent.identifier))));return module;
    }
    await(await load(path.join(root,'app.js'))).evaluate();
    const $=id=>doc.getElementById(id),submit=id=>$(id).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    const set=(id,value)=>{$(id).value=value;$(id).dispatchEvent(new w.Event('change',{bubbles:true}));};
    await until(()=>$('fact-radical').textContent===metadata.永.radical,'Dictionary did not load');
    await until(()=>!$('stroke-status').textContent.includes('正在加载'),'Initial stroke request did not settle');
    const lookup=async char=>{set('character-input',char);submit('lookup-form');await until(()=>$('current-character').textContent===char);await until(()=>!$('stroke-status').textContent.includes('正在加载'),'Stroke request did not settle');};
    const newNote=async({kind='component',target='氵',position='left',content='  第一行\n第二行：保持原文。\n',conditions='',title='三点水笔记'}={})=>{
      $('new-note').click();for(const [id,value]of Object.entries({'note-kind':kind,'note-title':title,'note-target':target,'note-position':position,'note-scope':'top','note-conditions':conditions,'note-content':content,'note-source':'测试用个人笔记，非教材引用'}))set(id,value);
      submit('note-form');await until(()=>!$('note-dialog').open,`Note did not save: ${$('note-form-status').textContent}`);
    };
    const importText=async text=>{Object.defineProperty($('import-file'),'files',{configurable:true,value:[{name:'backup.json',size:Buffer.byteLength(text),text:async()=>text}]});$('import-file').dispatchEvent(new w.Event('change',{bubbles:true}));await delay(45);};
    return{w,doc,$,set,submit,lookup,newNote,importText,calls,downloads,consoleErrors};
  }
  test('real page boots with only three simplified sections and preserves legacy storage',async t=>{
    const {$,doc,w,calls,consoleErrors}=await setup(t);assert.match(doc.title,/一字一法/);assert.match($('fact-count').textContent,/5/);
    // jsdom does not resolve CSS custom properties to rendered colors.
    assert.equal(w.getComputedStyle(doc.documentElement).getPropertyValue('--paper').trim(),'#F6F3EB');assert.equal(consoleErrors.filter(error=>/CSS|stylesheet/.test(error.message)).length,0);
    for(const page of ['lookup','notebook','data']){doc.querySelector(`[data-page="${page}"]`).click();assert.equal($(`page-${page}`).hidden,false);}
    assert.equal(doc.getElementById('teacher-form'),null);assert.equal(doc.getElementById('practice-canvas'),null);
    assert.equal(w.localStorage.getItem('moxi-legacy-learning'),'preserve me');assert.ok(calls.every(url=>url.includes('/data/characters')));
  });
  test('actual Hanzi Writer creates SVG from the bundled character data',async t=>{
    const {$,lookup}=await setup(t,{realEngine:true});await until(()=>$('writer-target').querySelectorAll('svg path').length>0,'Real library did not create SVG');assert.equal($('glyph-fallback').hidden,true);
    assert.equal($('writer-target').querySelector('svg').getAttribute('viewBox'),'0 0 400 400');
    await lookup('橋');await until(()=>$('writer-target').querySelectorAll('svg path').length>0);assert.match($('stroke-status').textContent,new RegExp(String(metadata.橋.strokesCount)));
  });
  test('a component note preserves whitespace and is reused for 江 and 河 without treating 水 as 氵',async t=>{
    const {newNote,lookup,$,w}=await setup(t),content='  第一行\n第二行：保持原文。\n';await newNote({content});
    assert.equal(JSON.parse(w.localStorage.getItem(storageKey)).notes[0].content,content);
    for(const char of ['江','河']){await lookup(char);assert.ok($('matched-notes').textContent.includes(content));}
    await lookup('水');assert.ok(!$('matched-notes').textContent.includes(content));
  });
  test('new-note timestamps remain valid when successive clock reads advance',async t=>{
    const {newNote,w}=await setup(t,{tickingClock:true});await newNote();const note=JSON.parse(w.localStorage.getItem(storageKey)).notes[0];assert.equal(note.createdAt,note.updatedAt);
  });
  test('free-text conditions stay in the candidate group with their original wording',async t=>{
    const {newNote,lookup,$}=await setup(t);await newNote({conditions:'仅在三点位置与所选例字相符时适用'});await lookup('湖');
    assert.match($('matched-notes').querySelector('.candidates').textContent,/仅在三点位置/);
  });
  test('whole-character notes distinguish 桥 from 橋',async t=>{
    const {newNote,lookup,$}=await setup(t);await newNote({kind:'character',target:'橋',position:'any',content:'繁体橋的专用个人记录',title:'橋字'});
    await lookup('橋');assert.match($('matched-notes').textContent,/繁体橋的专用个人记录/);await lookup('桥');assert.doesNotMatch($('matched-notes').textContent,/繁体橋的专用个人记录/);
  });
  test('JSON export restores a fresh notebook and repeated import does not duplicate notes',async t=>{
    const first=await setup(t);await first.newNote();first.$('export-backup').click();await until(()=>first.downloads.length>0);
    const text=await first.downloads.at(-1).text(),payload=JSON.parse(text);assert.equal(payload.application,'moxi-notebook');assert.equal(payload.notes.length,1);assert.ok(!text.includes('strokesCount'));
    const second=await setup(t);await second.importText(text);assert.equal(second.$('import-preview').hidden,false);assert.equal(second.w.localStorage.getItem(storageKey),null);
    second.$('confirm-import').click();await until(()=>JSON.parse(second.w.localStorage.getItem(storageKey)||'{}').notes?.length===1);
    await second.importText(text);second.$('confirm-import').click();await delay(40);assert.equal(JSON.parse(second.w.localStorage.getItem(storageKey)).notes.length,1);
  });
  test('invalid import preserves notes and HTML in a note stays inert plain text',async t=>{
    const {newNote,importText,$,w,doc}=await setup(t);await newNote({content:'<img src=x onerror="window.pwned=true">\n原文仅作文字显示'});
    assert.equal(doc.querySelector('img[src="x"]'),null);assert.equal(w.pwned,undefined);
    const before=w.localStorage.getItem(storageKey);await importText('{invalid');assert.equal(w.localStorage.getItem(storageKey),before);assert.match($('import-status').textContent,/失败|无效|格式|无法/);
  });
  test('missing data remains explicit and multiple-character lookup cannot replace the current character',async t=>{
    const {$,set,submit,lookup}=await setup(t),missing=['𰻞','𪚥','𠮷'].find(char=>!metadata[char]);assert.ok(missing);
    await lookup(missing);await until(()=>/未|暂无|缺|失败/.test($('stroke-status').textContent));assert.equal($('play-button').disabled,true);
    set('character-input','两个');submit('lookup-form');assert.equal($('current-character').textContent,missing);
  });
  test('conflicting import can create a separate copy while preserving the original note',async t=>{
    const {$,w,newNote,downloads,importText,doc}=await setup(t);await newNote();$('export-backup').click();await until(()=>downloads.length>0);
    const incoming=JSON.parse(await downloads.at(-1).text());incoming.notes[0].content='导入版本的独立内容';incoming.notes[0].updatedAt=new Date(Date.now()+1000).toISOString();
    await importText(JSON.stringify(incoming));assert.equal(JSON.parse(w.localStorage.getItem(storageKey)).notes.length,1);
    const choice=doc.querySelector('#import-conflicts select[data-conflict-kind="notes"]');assert.ok(choice);choice.value='copy';$('confirm-import').click();
    const notes=JSON.parse(w.localStorage.getItem(storageKey)).notes;assert.equal(notes.length,2);assert.notEqual(notes[0].id,notes[1].id);assert.ok(notes.some(note=>note.content==='导入版本的独立内容'));
  });
  test('manual character correction enables matching without inventing stroke data and can clear all parts',async t=>{
    const {$,set,submit,newNote,lookup,doc}=await setup(t);await newNote();const missing=['𰻞','𪚥','𠮷'].find(char=>!metadata[char]);await lookup(missing);
    $('edit-character').click();set('override-structure','左右结构');set('override-radical','氵');$('add-override-component').click();
    doc.querySelector('#override-components input').value='氵';doc.querySelector('#override-components select').value='left';submit('override-form');
    await until(()=>!$('override-dialog').open);assert.match($('analysis-label').textContent,/用户修订/);assert.match($('matched-notes').textContent,/三点水笔记/);assert.equal($('play-button').disabled,true);
    $('edit-character').click();for(const button of doc.querySelectorAll('#override-components .remove-component'))button.click();submit('override-form');
    assert.doesNotMatch($('matched-notes').textContent,/三点水笔记/);assert.equal($('component-list').querySelectorAll('.component-chip').length,0);
  });
  test('editing preserves identity and deletion requires the confirmation dialog',async t=>{
    const {$,set,submit,newNote,doc,w}=await setup(t);await newNote();const original=JSON.parse(w.localStorage.getItem(storageKey)).notes[0];
    doc.querySelector('#notebook-list .note-controls button').click();set('note-content','修改后的原文');submit('note-form');
    const edited=JSON.parse(w.localStorage.getItem(storageKey)).notes[0];assert.equal(edited.id,original.id);assert.equal(edited.createdAt,original.createdAt);assert.equal(edited.content,'修改后的原文');
    const remove=()=>[...doc.querySelectorAll('#notebook-list .note-controls button')].find(button=>button.textContent==='删除').click();
    remove();assert.equal($('confirm-dialog').open,true);$('confirm-no').click();assert.equal(JSON.parse(w.localStorage.getItem(storageKey)).notes.length,1);
    remove();$('confirm-yes').click();assert.equal(JSON.parse(w.localStorage.getItem(storageKey)).notes.length,0);
  });
  test('failed browser persistence retains the new note for emergency export and shows an unsaved warning',async t=>{
    const {$,newNote,w,downloads}=await setup(t);w.Storage.prototype.setItem=function(){throw Error('QuotaExceededError');};await newNote();
    assert.equal($('storage-warning').hidden,false);assert.match($('storage-status').textContent,/未保存/);assert.equal(w.localStorage.getItem(storageKey),null);
    $('emergency-export').click();await until(()=>downloads.length>0);const backup=JSON.parse(await downloads.at(-1).text());assert.equal(backup.notes.length,1);
  });
}
