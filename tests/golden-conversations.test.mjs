import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Runtime} from '../runtime/engine.mjs';

const cases=JSON.parse(await readFile(new URL('./fixtures/golden-conversations.json',import.meta.url),'utf8'));
for(const sample of cases)test(`${sample.id}: ${sample.prompt}`,async t=>{
 const dir=await mkdtemp(join(tmpdir(),'shutong-golden-'));const r=await Runtime.open(dir);
 t.after(async()=>{r.close();await rm(dir,{recursive:true,force:true})});
 const concept={id:'software/hash-table',name:'哈希表'};
 await r.store.setExplanationCount('local',concept.id,sample.count);
 if(sample.known)await r.store.setKnown('local',concept.id,true);
 if(sample.threshold)await r.store.setThreshold('local',sample.threshold);
 if(sample.config)r.config.set('global','',sample.config);
 const event={session_id:'s',turn_id:sample.id};const {key}=await r.start(event);
 const result=await r.context(key,[concept],sample.explain?[concept.id]:[],{domain:'software',overrides:sample.overrides});
 assert.equal(result.concepts[0].mode,sample.mode);
 assert.equal(result.presentationPolicy.mode,sample.presentation);
 assert.equal(result.preserveCriticalInformation,true);
 if(sample.overrides?.discussionOnly)assert.equal(result.presentationPolicy.mayModifyProject,false);
 if(sample.overrides?.excludedModalities)assert.deepEqual(result.presentationPolicy.excludedModalities,sample.overrides.excludedModalities);
 if(sample.config?.preferArtifacts===false)assert.deepEqual(result.presentationPolicy.media,{default:'text'});
 assert.equal(r.config.resolve().verbosity,'auto','answer override must not become persistent');
});
