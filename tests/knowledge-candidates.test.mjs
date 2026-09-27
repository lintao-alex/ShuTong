import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Runtime} from '../runtime/engine.mjs';
import {contextResponse} from '../runtime/wire.mjs';
const original={id:'api-idempotency',name:'API 幂等性'};
const guess={id:'api.idempotency',name:'API 幂等性'};
async function setup(t){const dir=await mkdtemp(join(tmpdir(),'shutong-candidates-'));const r=await Runtime.open(dir);t.after(async()=>{r.close();await rm(dir,{recursive:true,force:true});});await r.store.setName('local',original.id,original.name);await r.store.setExplanationCount('local',original.id,1);const event={session_id:'new-session',turn_id:'one'};const {key}=await r.start(event);return {r,key,event};}

test('ID/domain drift returns a bounded candidate without automatically merging the guessed concept',async t=>{
 const {r,key,event}=await setup(t);const before=await r.store.exportProfile('local');
 const result=await r.context(key,[guess],[],{domain:'distributed-systems'});
 assert.equal(result.concepts[0].id,guess.id);assert.equal(result.concepts[0].mode,'normal');
 assert.deepEqual(result.concepts[0].candidates,[{...original,count:1,domainHint:null,mode:'suppress-basics'}]);
 assert.deepEqual(await r.store.exportProfile('local'),before);
 assert.deepEqual(contextResponse(result).concepts[0].candidates,result.concepts[0].candidates);
 // The candidate was actually returned by context; choosing its canonical ID needs no extra call.
 await r.stage(key,[{...original,evidence:''}]);await r.stop({...event,last_assistant_message:'这里应用 API 幂等性。'});
 assert.equal((await r.store.list('local')).concepts.length,1);
 assert.equal((await r.store.list('local')).concepts[0].explanationCount,1);
});

test('same-name foreign domains stay normal until selected, and rejecting a candidate preserves separate records',async t=>{
 const {r,key,event}=await setup(t);
 await r.store.setName('local','images/filter','过滤器');await r.store.setKnown('local','images/filter',true);
 await r.store.setName('other','network/filter','过滤器');await r.store.setKnown('other','network/filter',true);
 const input={id:'network/filter',name:'过滤器'};const result=await r.context(key,[input],[],{domain:'network'});
 assert.equal(result.concepts[0].mode,'normal');assert.equal(result.concepts[0].candidates.length,1);
 assert.equal(result.concepts[0].candidates[0].domainHint,'images');
 const evidence='网络过滤器根据指定网络规则筛选请求。';
 await r.stage(key,[{...input,evidence}]);await r.stop({...event,last_assistant_message:evidence});
 assert.equal((await r.store.read({userId:'local',conceptIds:[input.id]})).concepts[0].explanationCount,1);
 assert.equal((await r.store.read({userId:'local',conceptIds:['images/filter']})).concepts[0].explanationCount,0);
});

test('explicit questions, custom thresholds and disabled profile application also govern candidates',async t=>{
 const {r,key}=await setup(t);
 assert.equal((await r.context(key,[guess],[guess.id],{domain:'distributed-systems'})).concepts[0].candidates[0].mode,'explain-on-request');
 await r.store.setThreshold('local',3);
 assert.equal((await r.context(key,[guess])).concepts[0].candidates[0].mode,'normal');
 await r.store.setKnown('local',original.id,true);
 assert.equal((await r.context(key,[guess])).concepts[0].candidates[0].mode,'suppress-basics');
 r.config.set('global','',{suppressKnownConcepts:false});
 assert.equal((await r.context(key,[guess])).concepts[0].candidates[0].mode,'normal');
 r.config.set('global','',{adaptiveResponse:false});
 r.store.findNameCandidates=()=>{throw new Error('Must not read candidates when profile application is disabled');};
 assert.equal((await r.context(key,[guess])).concepts[0].candidates,undefined);
});

test('candidate retrieval excludes unrelated records, single-character ambiguity and unbounded profile injection',async t=>{
 const {r,key}=await setup(t);
 for(let i=0;i<20;i++)await r.store.setName('local',`retrieval/${i}`,`检索方案${i}`);
 const response=await r.context(key,Array.from({length:20},(_,i)=>({id:`new/${i}`,name:'检索方案'})),[],{domain:'new'});
 const candidates=response.concepts.flatMap(c=>c.candidates??[]);
 assert.equal(candidates.length,12);assert.ok(response.concepts.every(c=>(c.candidates?.length??0)<=3));
 assert.ok(candidates.every(c=>c.id.startsWith('retrieval/')));
 const repeated=await r.context(key,Array.from({length:20},()=>({id:'new/repeated',name:'检索方案'})),[],{domain:'new'});
 assert.equal(repeated.concepts.flatMap(c=>c.candidates??[]).length,12);
 assert.deepEqual(await r.store.findNameCandidates('local','树','new/tree'),[]);
 assert.deepEqual(await r.store.findNameCandidates('local','a%','new/literal'),[]);
});
