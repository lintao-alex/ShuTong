import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {Runtime} from '../runtime/engine.mjs';
import {SqliteKnowledgeStore} from '../packages/user-information/dist/index.js';
const c={id:'software/hash',name:'哈希表',evidence:'哈希表通过哈希函数定位键值。'};
const event={session_id:'s',turn_id:'t'};
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'shutong-config-'));const r=await Runtime.open(dir);t.after(async()=>{r.close();await rm(dir,{recursive:true,force:true})});const {key}=await r.start(event);return {r,key,dir};}

test('configuration overlays follow global domain session answer precedence and clearing restores inheritance',async t=>{
 const {r,key}=await fixture(t);r.config.set('global','',{progressiveDetails:false});r.config.set('domain','software',{progressiveDetails:true});r.config.set('session','s',{progressiveDetails:false});
 const answer=await r.context(key,[c],[],{domain:'software',overrides:{progressiveDetails:true,verbosity:'detailed',discussionOnly:true,excludedModalities:['diagram']}});
 assert.equal(answer.config.progressiveDetails,true);assert.equal(answer.presentationPolicy.mode,'full');assert.equal(answer.presentationPolicy.mayModifyProject,false);
 assert.deepEqual(answer.presentationPolicy.excludedModalities,['diagram']);
 assert.equal(r.config.resolve({domain:'software',sessionId:'s'}).progressiveDetails,false);
 r.config.clear('session','s');assert.equal(r.config.resolve({domain:'software',sessionId:'s'}).progressiveDetails,true);
 assert.throws(()=>r.config.set('global','',{cloudSync:true}));
});
test('auto recording off applies existing knowledge but stops already-staged writes',async t=>{
 const {r,key}=await fixture(t);await r.store.setKnown('local',c.id,true);await r.context(key,[c]);await r.stage(key,[c]);r.config.set('global','',{autoRecord:false});
 assert.equal((await r.context(key,[c])).concepts[0].mode,'suppress-basics');await r.stop({...event,last_assistant_message:c.evidence});
 assert.equal((await r.store.list('local')).concepts[0].explanationCount,0);
});
test('record-only records without applying suppression; profile-off skips both automatically',async t=>{
 const {r,key}=await fixture(t);await r.store.setKnown('local',c.id,true);r.config.set('global','',{adaptiveResponse:false});
 assert.equal((await r.context(key,[c])).concepts[0].mode,'normal');await r.stage(key,[c]);await r.stop({...event,last_assistant_message:c.evidence});
 assert.equal((await r.store.list('local')).concepts[0].explanationCount,1);
 r.config.set('global','',{adaptiveResponse:true,profileEnabled:false});const next=await r.start({...event,turn_id:'next'});
 assert.equal((await r.context(next.key,[c])).concepts[0].mode,'normal');await r.stage(next.key,[c]);await r.stop({...event,turn_id:'next',last_assistant_message:c.evidence});
 assert.equal((await r.store.list('local')).concepts[0].explanationCount,1);
});
test('suppression and progressive flags are independent; detailed override does not mutate defaults',async t=>{
 const {r,key}=await fixture(t);await r.store.setKnown('local',c.id,true);r.config.set('global','',{suppressKnownConcepts:false,progressiveDetails:false});
 assert.equal((await r.context(key,[c])).concepts[0].mode,'normal');await assert.rejects(r.stage(key,[],{trunk:'主干',details:[]}),/disabled/);
 assert.equal(r.config.resolve().verbosity,'auto');
});
test('audited updates can be undone without allowing old delivery retries to count again',async t=>{
 const {r}=await fixture(t);const delivery={userId:'local',hostId:'test',sessionId:'s',requestId:'r',responseId:'a',explainedConceptIds:[c.id],mentionedConceptIds:[]};
 await r.store.recordDelivered(delivery);let log=await r.store.auditLog('local');assert.equal(log[0].kind,'auto-count');
 await r.store.setKnown('local',c.id,true);await assert.rejects(r.store.undo('local',log[0].id),/Later/);
 log=await r.store.auditLog('local');await r.store.undo('local',log[0].id);await r.store.undo('local',log[1].id);
 await r.store.recordDelivered(delivery);assert.equal((await r.store.list('local')).concepts[0].explanationCount,0);
});
test('same names in distinct domains are not auto-merged, and explicit aliases round-trip',async t=>{
 const {r}=await fixture(t);await r.store.setName('local','physics/tree','树');await r.store.setName('local','software/tree','树');
 assert.equal((await r.store.resolveNames('local',[{id:'software/other-tree',name:'树'}],'software'))[0].id,'software/tree');
 assert.equal((await r.store.resolveNames('local',[{id:'biology/tree',name:'树'}],'biology'))[0].id,'biology/tree');
 await r.store.setAlias('local','software','Tree view','software/tree');const snapshot=await r.store.exportProfile('local');await r.store.importProfile('copy',snapshot);
 assert.equal((await r.store.resolveNames('copy',[{id:'software/widget',name:'Tree view'}],'software'))[0].id,'software/tree');
});
test('v1 knowledge database migrates without changing records or a custom threshold',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'shutong-migration-'));const path=join(dir,'profile.sqlite');t.after(()=>rm(dir,{recursive:true,force:true}));
 let store=new SqliteKnowledgeStore(path);await store.setExplanationCount('local',c.id,4);await store.setThreshold('local',3);store.close();
 const db=new DatabaseSync(path);db.exec('DROP TABLE aliases;DROP TABLE audit;PRAGMA user_version=1');db.close();
 store=new SqliteKnowledgeStore(path);assert.equal((await store.list('local')).threshold,3);assert.equal((await store.list('local')).concepts[0].explanationCount,4);store.close();
});
