const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let values = {}, failWrite = false;
const clone = x => JSON.parse(JSON.stringify(x));
const context = { console, Date, Map, Set, JSON, Object, Error, Array, String,
  STORAGE_KEY: 'data', chrome: { storage: { local: {
    async get(keys) { if (keys == null) return clone(values); const out={}; for (const key of typeof keys === 'string' ? [keys] : keys) if(key in values)out[key]=values[key]; return clone(out); },
    async set(patch) { if (failWrite) throw Error('Simulated storage failure'); Object.assign(values,clone(patch)); },
    async remove(keys) { for (const key of typeof keys === 'string' ? [keys] : keys) delete values[key]; }
  }}}, getData: async()=>clone(values.data || {links:[],settings:{},history:[]}),
  getPublicSettings: s=>s, sanitizeSettingsPatch: s=>s,
  getImagesFromIndexedDB:async()=>[], saveImagesToIndexedDB:async()=>true,
  clearIndexedDBImages:async()=>true, saveData:async data=>{await context.chrome.storage.local.set({data});return true;}
}; vm.createContext(context);vm.runInContext(fs.readFileSync('audit_storage.js','utf8'),context);
(async()=>{
 const row={id:'a',url:'https://walmart.com/ip/12345678',title:'Original',price:'40',images:['original']};
 values.zhunterMasterSheet=[clone(row)];const baseline=clone(values.zhunterMasterSheet);
 await context.zhMasterCommit({baseline,rows:[{...row,title:'Edited'}]});
 await context.zhMasterCommit({baseline,rows:[{...row,images:['edited-image']}]});
 assert.equal(values.zhunterMasterSheet[0].title,'Edited');assert.deepEqual(values.zhunterMasterSheet[0].images,['edited-image']);
 await assert.rejects(context.zhMasterCommit({baseline,rows:[{...row,title:'Conflicting'}]}),/changed elsewhere/);
 const fresh=clone(values.zhunterMasterSheet);values.zhunterMasterSheet.push({...row,id:'b',url:'https://walmart.com/ip/87654321'});
 await context.zhMasterCommit({baseline:fresh,rows:[{...fresh[0],temuBase:123}]});assert.equal(values.zhunterMasterSheet.length,2);assert.equal(values.zhunterMasterSheet[0].price,'40');
 const deletion=clone(values.zhunterMasterSheet);await context.zhMasterCommit({baseline:deletion,rows:deletion.filter(r=>r.id!=='a')});assert.deepEqual(values.zhunterMasterSheet.map(r=>r.id),['b']);
 await assert.rejects(context.zhMasterCommit({baseline:deletion,rows:deletion}),/deleted elsewhere/);
 const beforeFailure=clone(values);failWrite=true;await assert.rejects(context.zhMasterCommit({baseline:values.zhunterMasterSheet,rows:[{...values.zhunterMasterSheet[0],title:'Failed'}]}),/storage failure/);failWrite=false;assert.deepEqual(values,beforeFailure);
 values.data={links:[{id:'link'}],settings:{temuStores:{Store:{config:{defaults:{}}}}},history:[]};values.groqApiKeys=['PRIVATE'];values.zhSourcingConnection={token:'PRIVATE'};values.zhunterBulkQueue=[{id:'q',url:'https://walmart.com/ip/12345678'}];values.zhTextEdits={edit:{}};
 const {backup}=await context.zhBackupExport();assert(!JSON.stringify(backup).includes('PRIVATE'));const original=clone(backup.values);values.zhunterMasterSheet=[];await context.zhBackupRestore(backup);for(const key of Object.keys(original))assert.deepEqual(values[key],original[key]);assert.equal(values.groqApiKeys[0],'PRIVATE');
 await assert.rejects(context.zhBackupRestore({format:'wrong',version:2}),/Unsupported/);
 await context.zhMasterReset(false);assert(!values.zhunterMasterSheet);assert(values.zhunterBulkQueue);assert(values.zhSourcingConnection);
 await context.zhMasterReset(true);assert(!values.zhunterBulkQueue);assert(values.zhSourcingConnection);assert.equal(values.groqApiKeys[0],'PRIVATE');
 console.log('PASS: field-only merge, stale updates/deletions, conflicts, failure propagation, backup/restore and reset scope');
})().catch(e=>{console.error(e);process.exitCode=1});
