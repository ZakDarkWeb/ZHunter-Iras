const fs=require('fs'),path=require('path'),assert=require('assert'),{spawn}=require('child_process');
fs.mkdirSync('tmp',{recursive:true});const profile=path.resolve('tmp/category-profile-'+process.pid);fs.mkdirSync(profile);
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));let ws;
(async()=>{
 let tabs;for(let i=0;i<100;i++){try{const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];tabs=await(await fetch('http://127.0.0.1:'+port+'/json')).json();break;}catch{}await wait(100);}assert(tabs);
 ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let seq=0;const pending=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const stub=`const store={},hook={addListener(){},removeListener(){}},blank=(...args)=>{if(typeof args.at(-1)==='function')args.at(-1)([]);return Promise.resolve([]);};const local={get(k,cb){const out=typeof k==='string'?{[k]:store[k]}:store;const copy=structuredClone(out);cb?.(copy);return Promise.resolve(copy);},set(v,cb){Object.assign(store,structuredClone(v));cb?.();return Promise.resolve();},remove:blank};window.chrome={runtime:{id:'test',lastError:null,getURL:p=>new URL(p,location.href).href,getManifest:()=>({version:'9.12.13'}),onMessage:hook,onConnect:hook,sendMessage(m,cb){if(m.action==='MASTER_COMMIT'){const p=zhMasterCommit(m).then(r=>{cb?.(r);return r;}).catch(e=>{const r={success:false,error:e.message};cb?.(r);return r;});return p;}if(m.action==='MASTER_BATCH_ADD'){const b=m.batch,a=store.zhunterMasterBatches||[];const old=a.find(x=>x.id===b.id);if(old){old.urls=[...new Set([...(old.urls||[]),...b.urls])];old.count=old.urls.length;}else a.unshift({...b,count:b.urls.length});store.zhunterMasterBatches=a;const r={success:true};cb?.(r);return Promise.resolve(r);}if(m.action==='TEMU_AUTO_UPLOAD'&&window.__auditMsg){const p=Promise.resolve(window.__auditMsg(m)).then(r=>{cb?.(r);return r;});return p;}const r=m.action==='SOURCING_STATUS'?{success:true,connected:false,pending:0}:{success:true,data:{settings:{},links:[],folders:[],tags:[]}};cb?.(r);return Promise.resolve(r);}},storage:{local,sync:local,onChanged:hook},tabs:{query:blank,get:blank,update:blank,create:blank,sendMessage:blank,onActivated:hook,onUpdated:hook,onRemoved:hook},windows:{getCurrent:blank},downloads:{download:blank,onChanged:hook},scripting:{executeScript:blank},commands:{onCommand:hook},sidePanel:{open:blank},extension:{isAllowedIncognitoAccess:blank}};`;
 await send('Page.enable');await send('Page.addScriptToEvaluateOnNewDocument',{source:stub+fs.readFileSync('audit_storage.js','utf8')});await send('Emulation.setDeviceMetricsOverride',{width:500,height:960,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:'file:///'+path.resolve('sidepanel.html').replace(/\\/g,'/')});for(let i=0;i<100;i++){if(await evaluate('typeof openTemuModal === "function" && typeof zhTextGenerate === "function"'))break;await wait(100);}


 const result=await evaluate(`(async()=>{
 const check=(c,m)=>{if(!c)throw Error(m);},pass=[];
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=';
 TemuImgStepper={queue:[{product:{id:'ui-test',title:'Silicone Cooking Utensils Set'},imgUrl:png,imgIndex:0}],currentIndex:0,running:true,engine:'flow',stats:{done:0,skipped:0},activeJobId:'active'};
 temuStepSendCurrent=async()=>{};temuStepOpenModal();
 const manual=document.getElementById('temuStepManualTools'),recovery=document.getElementById('temuStepRecoveryTools'),again=document.getElementById('temuStepSendAgainBtn');
 check(!manual.open&&!recovery.open,'tools initially collapsed');
 check(document.getElementById('temuStepProdName').textContent==='Silicone Cooking Utensils Set','current title');
 const img=document.getElementById('temuStepImg');await img.decode();check(img.naturalWidth>0,'thumbnail loaded');pass.push('current title and thumbnail');
 check(again.disabled,'active submission disabled');TemuImgStepper.activeJobId=null;temuStepSetStatus('Ready');check(!again.disabled,'inactive resend enabled');pass.push('active/inactive resend states');
 TemuImgStepper.queue[0].resultUrl=png;temuStepSetStatus('Retry save','error');check(again.textContent==='Retry Save'&&!again.disabled,'retry save');pass.push('retained result retry');
 manual.open=true;recovery.open=true;check(manual.contains(document.getElementById('temuStepDeviceBtn'))&&manual.contains(document.getElementById('temuStepPasteFlowBtn'))&&recovery.contains(again),'tool placement');
 const actions=document.getElementById('temuStepMainActions');check(actions.children.length===2&&actions.contains(document.getElementById('zhFlowPause'))&&actions.contains(document.getElementById('temuStepSkipBtn')),'main controls');pass.push('collapsible tools and two main controls');
 await document.getElementById('zhFlowPause').onclick();check(TemuImgStepper.paused,'pause handler');await document.getElementById('zhFlowPause').onclick();check(!TemuImgStepper.paused,'resume handler');pass.push('pause/resume handler');
 const q=TemuImgStepper.queue[0];q.batchMode='pack_background';q.packQty=2;q.stages=temuBatchStages('pack_background',2,'Background');q.stageIndex=1;q.packReview=true;q.done=true;q.continueStage=true;
 temuStepRefreshPresentation();check(!document.getElementById('temuStepPackReview').hidden&&again.disabled,'pack review shown and resend blocked');
 const schedule=temuStepScheduleNext;temuStepScheduleNext();check(!TemuImgStepper.pauseToken,'review must not schedule background');let scheduled=0;temuStepScheduleNext=()=>scheduled++;
 await document.getElementById('temuStepApprovePack').onclick();check(!q.packReview&&scheduled===1&&q.stageIndex===1,'approval continues background');
 q.packReview=true;await document.getElementById('temuStepRetryPack').onclick();check(!q.packReview&&q.stageIndex===0&&q.prompt===q.stages[0]&&!q.done,'retry returns to pack');
 check(q.prompt.includes('complete identical product sets')&&q.prompt.includes('every component'),'complete set prompt');pass.push('pack review, approval and retry');temuStepScheduleNext=schedule;
 manual.open=false;recovery.open=false;
 for(const theme of ['light','dark']){document.body.classList.toggle('light-mode',theme==='light');await new Promise(r=>requestAnimationFrame(r));const box=document.querySelector('.temu-stepper-box'),r=box.getBoundingClientRect();check(r.width>0&&r.right<=innerWidth&&r.left>=0,'fits '+theme);check(box.scrollWidth<=box.clientWidth,'no horizontal overflow '+theme);pass.push(theme+' layout');}
 return pass;
 })()`);console.log('PASS Chrome stepper UI: '+result.join('; '));await send('Page.captureScreenshot',{format:'png'}).then(r=>fs.writeFileSync('tmp/flow-stepper-ui.png',Buffer.from(r.data,'base64')));await send('Browser.close');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{ws?.close();chrome.kill();});
