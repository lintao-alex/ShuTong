import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Script} from 'node:vm';
import {SqliteKnowledgeStore} from '../packages/user-information/dist/index.js';
import {servePanel} from '../runtime/panel.mjs';
import {client} from '../runtime/panel-view.mjs';

async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'shutong-edit-'));
 const store=new SqliteKnowledgeStore(join(directory,'knowledge.sqlite'));
 t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
 await store.setName('local','software/cache','缓存');await store.setExplanationCount('local','software/cache',2);
 const current=async()=> (await store.list('local')).concepts[0];
 return {directory,store,current};
}
test('name and count save as one reversible change, preserving known marks and retry receipts',async t=>{
 const {store,current}=await fixture(t);await store.setKnown('local','software/cache',true);
 const event={userId:'local',hostId:'test',sessionId:'s',requestId:'r',responseId:'a',explainedConceptIds:['software/cache'],mentionedConceptIds:[]};
 await store.recordDelivered(event);const before=await current();const count=(await store.auditLog('local')).length;
 await store.editConcept('local',before.conceptId,{name:'  查询缓存  ',explanationCount:0,expected:before});
 assert.deepEqual(await current(),{...before,name:'查询缓存',explanationCount:0});
 const audit=await store.auditLog('local');assert.equal(audit.length,count+1);assert.equal(audit[0].kind,'manual-edit');
 await store.recordDelivered(event);assert.equal((await current()).explanationCount,0);
 await store.undo('local',audit[0].id);assert.deepEqual(await current(),before);
});
test('an automatic increment or manual known change rejects a stale editor without partial writes',async t=>{
 const {store,current,directory}=await fixture(t),before=await current();
 const other=new SqliteKnowledgeStore(join(directory,'knowledge.sqlite'));t.after(()=>other.close());
 await other.setExplanationCount('local',before.conceptId,3);
 const count=(await store.auditLog('local')).length;
 await assert.rejects(store.editConcept('local',before.conceptId,{name:'错误覆盖',explanationCount:0,expected:before}),/changed/);
 assert.deepEqual(await current(),{...before,explanationCount:3});assert.equal((await store.auditLog('local')).length,count);
 const latest=await current();await other.setKnown('local',before.conceptId,true);
 await assert.rejects(store.editConcept('local',before.conceptId,{name:'错误覆盖',explanationCount:1,expected:latest}),/changed/);
});
test('invalid and missing edits leave the profile unchanged; no-op adds no audit event',async t=>{
 const {store,current}=await fixture(t),before=await current(),snapshot=await store.exportProfile('local'),count=(await store.auditLog('local')).length;
 for(const edit of [{name:' '},{explanationCount:-1},{explanationCount:1.5},{explanationCount:Number.MAX_SAFE_INTEGER+1},{expected:null},{expected:{...before,manuallyKnown:'true'}}])
  await assert.rejects(store.editConcept('local',before.conceptId,{name:'新名',explanationCount:1,expected:before,...edit}));
 await assert.rejects(store.editConcept('local','missing',{name:'新名',explanationCount:1,expected:before}),/changed/);
 await assert.rejects(store.editConcept('other',before.conceptId,{name:'新名',explanationCount:1,expected:before}),/changed/);
 await store.editConcept('local',before.conceptId,{name:before.name,explanationCount:before.explanationCount,expected:before});
 assert.deepEqual(await store.exportProfile('local'),snapshot);assert.equal((await store.auditLog('local')).length,count);
});
test('panel endpoint requires authentication, validates edits, reports conflict and exposes undo',async t=>{
 const {store,current,directory}=await fixture(t);const panel=await servePanel(directory);
 t.after(()=>new Promise(resolve=>panel.server.close(resolve)));
 const expected=await current(),payload={id:expected.conceptId,name:'缓存策略',explanationCount:4,expected};
 const post=(path,body,token=panel.token,origin=panel.url)=>fetch(`${panel.url}${path}?token=${token}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
 assert.equal((await post('/edit-concept',payload,'bad')).status,403);
 assert.equal((await post('/edit-concept',payload,panel.token,'https://example.org')).status,403);
 assert.equal((await post('/edit-concept',{...payload,explanationCount:-1})).status,400);
 assert.equal((await post('/edit-concept',payload)).status,200);
 assert.equal((await current()).explanationCount,4);
 const conflict=await post('/edit-concept',payload);assert.equal(conflict.status,409);assert.equal((await conflict.json()).error,'record-changed');
 const audit=await(await fetch(`${panel.url}/audit?token=${panel.token}`)).json();
 assert.equal(audit[0].kind,'manual-edit');assert.equal(audit[0].before.name,'缓存');assert.equal(audit[0].after.name,'缓存策略');
 assert.equal((await post('/undo',{id:audit[0].id})).status,200);assert.deepEqual(await current(),expected);
});
test('the served client remains valid JavaScript',()=>{assert.doesNotThrow(()=>new Script(client));});
