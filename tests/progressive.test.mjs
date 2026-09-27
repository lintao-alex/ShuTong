import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Runtime } from '../runtime/engine.mjs';
import { validatePresentation } from '../runtime/presentation.mjs';

const concept={id:'software/hash-table',name:'哈希表',evidence:'哈希表通过哈希函数将键映射到桶。'};
const presentation={trunk:'建议使用哈希表。最坏性能可能退化。',criticalPoints:['最坏性能可能退化。'],details:[
  {id:'implementation',title:'实现方式',body:concept.evidence,concepts:[concept]},
  {id:'collision',parentId:'implementation',title:'冲突处理',body:'可以采用链地址法。',concepts:[]},
  {id:'alternative',title:'其他方案',body:'这个旁支不应进入冲突细节上下文。',concepts:[]},
]};
async function setup(t){const dir=await mkdtemp(join(tmpdir(),'shutong-progressive-'));const r=await Runtime.open(dir);t.after(async()=>{r.close();await rm(dir,{recursive:true,force:true})});const event={session_id:'s',turn_id:'t'};const state=await r.start(event);await r.context(state.key,[concept]);await r.stage(state.key,[],presentation);return {r,key:state.key,event};}

test('critical points cannot be hidden, paths cannot cycle, and budgets are bounded',()=>{
 assert.throws(()=>validatePresentation({...presentation,trunk:'建议使用哈希表。'}),/Critical/);
 assert.throws(()=>validatePresentation({...presentation,details:[{id:'a',parentId:'a',title:'A',body:'B'}]}),/Cyclic/);
 assert.throws(()=>validatePresentation({...presentation,details:[{id:'a',parentId:'missing',title:'A',body:'B'}]}),/Missing/);
});
test('staged or hidden details never count; explicitly displayed details count once',async t=>{
 const {r,key,event}=await setup(t);await assert.rejects(r.detail(key,'implementation'),/not confirmed/);
 await r.stop({...event,last_assistant_message:presentation.trunk});
 assert.equal((await r.store.list('local')).concepts.length,0);
 assert.equal((await r.detail(key,'implementation')).node.body,concept.evidence);
 assert.equal((await r.store.list('local')).concepts.length,0);
 await r.viewedDetail(key,'implementation');await r.viewedDetail(key,'implementation');
 assert.equal((await r.store.list('local')).concepts[0].explanationCount,1);
});
test('detail lookup includes only selected node and ancestor content; summaries can flow back and be cleared',async t=>{
 const {r,key,event}=await setup(t);await r.stop({...event,last_assistant_message:presentation.trunk});
 const detail=await r.detail(key,'collision');assert.deepEqual(detail.ancestors,[{id:'implementation',title:'实现方式',body:concept.evidence}]);
 assert.ok(!JSON.stringify(detail).includes('旁支'));
 await r.saveTakeaway(key,'collision','采用标准库并保留性能限制。');
 assert.equal((await r.status(key)).presentation.takeaways.collision,'采用标准库并保留性能限制。');
 await r.clearDetails();assert.equal((await r.status(key)).presentation,null);assert.deepEqual((await r.turn(key)).takeaways,{});
});
test('if the actual answer changed, unpublished presentation is not exposed',async t=>{
 const {r,key,event}=await setup(t);await r.stop({...event,last_assistant_message:'实际答复不同。'});
 assert.equal((await r.status(key)).presentation,null);await assert.rejects(r.detail(key,'implementation'));
});
