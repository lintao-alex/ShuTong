import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Runtime} from '../runtime/engine.mjs';
import {validatePresentation,confirmPresentation} from '../runtime/presentation.mjs';
import {contextResponse} from '../runtime/wire.mjs';

const point='上线前必须确认访问权限。';
const main=`建议分阶段上线。\n\n${point}`;
const staged={criticalPoints:[point],details:[{id:'steps',title:'实施步骤',body:'先验证权限，再逐步开放访问。'}]};
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'shutong-efficiency-'));const runtime=await Runtime.open(dir);
 t.after(async()=>{runtime.close();await rm(dir,{recursive:true,force:true})});
 const event={session_id:'efficiency',turn_id:'one'};const {key}=await runtime.start(event);
 return {runtime,key,event};
}

test('omitted trunk is captured from delivered text once, preserving paragraphs and critical points',async t=>{
 const {runtime,key,event}=await fixture(t);await runtime.context(key,[]);await runtime.stage(key,[],staged);
 assert.equal((await runtime.turn(key)).presentation.trunk,undefined);
 assert.equal((await runtime.status(key)).presentation,null);
 await runtime.stop({...event,last_assistant_message:`${main}\n\n可展开：实施步骤\n\n[展开细节与知识点](http://127.0.0.1:1234/?token=test&turn=${key})`});
 assert.equal((await runtime.status(key)).presentation.trunk,main);
 assert.equal((await runtime.detail(key,'steps')).node.body,staged.details[0].body);
 assert.equal((await runtime.store.list('local')).concepts.length,0);
});

test('capture fails closed for missing anchors, absent critical information and over-budget text',()=>{
 assert.throws(()=>validatePresentation({...staged,criticalPoints:[]}),/criticalPoint/);
 const p=validatePresentation(staged);
 assert.equal(confirmPresentation(p,'建议分阶段上线。'),null);
 assert.equal(confirmPresentation(p,`${main}${'长'.repeat(5000)}`),null);
 assert.equal(confirmPresentation(p,''),null);
 assert.equal(confirmPresentation(p,`建议上线\n可展开：${point}`),null);
});

test('ordinary links and legacy supplied trunks retain exact-match behavior',()=>{
 const p=validatePresentation(staged);
 const text=`${main}\n\n[项目文档](https://example.org/doc)`;
 assert.equal(confirmPresentation(p,text).trunk,text);
 assert.equal(confirmPresentation(p,`${main}\n[展开细节与知识点](http://127.0.0.1:1234/?token=test)。`).trunk,main);
 const legacy=validatePresentation({...staged,trunk:main});
 assert.equal(confirmPresentation(legacy,`额外说明\n${main}`).trunk,main);
 assert.equal(confirmPresentation(legacy,point),null);
});

test('compact transport retains canonical knowledge and all output overrides without duplicate instructions',async t=>{
 const {runtime,key}=await fixture(t);
 await runtime.store.setKnown('local','software/hash',true);
 const full=await runtime.context(key,[{id:'software/hash',name:'哈希表'}],[],{overrides:{discussionOnly:true,excludedModalities:['diagram'],progressiveDetails:false}});
 const compact=contextResponse(full);
 assert.equal(compact.concepts[0].mode,'suppress-basics');
 assert.deepEqual(compact.config,full.config);
 assert.equal(compact.presentationPolicy.mode,'normal');assert.equal(compact.presentationPolicy.mayModifyProject,false);
 assert.deepEqual(compact.config.excludedModalities,['diagram']);assert.match(compact.instruction,/disabled/);
 assert.ok(JSON.stringify(compact).length<JSON.stringify(full).length);
});
