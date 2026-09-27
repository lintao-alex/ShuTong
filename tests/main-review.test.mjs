import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Runtime} from '../runtime/engine.mjs';
import {reviewMain,validatePresentation,confirmPresentation} from '../runtime/presentation.mjs';
const critical='上线前必须验证访问权限，不能依赖模型保密。';
const compact={reviewTrunk:true,trunk:`建议先试点。${critical}`,criticalPoints:[critical],details:[{id:'steps',title:'实施',body:'先检查权限，再安排试点。'}]};
const long={...compact,trunk:compact.trunk+'实施步骤应放入详情。'.repeat(70)};
async function fixture(t){const directory=await mkdtemp(join(tmpdir(),'shutong-main-review-'));const r=await Runtime.open(directory);t.after(async()=>{r.close();await rm(directory,{recursive:true,force:true})});const event={session_id:'review',turn_id:'one'};const {key}=await r.start(event);await r.context(key,[]);return {r,key,event};}

test('review measures Chinese characters and English words while excluding markdown link destinations',()=>{
 const p=validatePresentation(compact);assert.equal(reviewMain(p).status,'accepted');assert.equal(reviewMain(p).unit,'characters');
 const linked={...p,trunk:p.trunk+` [文档](https://example.org/${'x'.repeat(1000)})`};assert.equal(reviewMain(linked).actual,reviewMain(p).actual+2);
 assert.equal(reviewMain(validatePresentation(long)).status,'revise');
 const english={...p,trunk:'Keep a backup. '+ 'word '.repeat(190),criticalPoints:['Keep a backup.']};
 assert.equal(reviewMain(english).unit,'words');assert.equal(reviewMain(english).status,'revise');
 assert.equal(reviewMain({...p,trunk:undefined}).status,'missing-trunk');
 assert.equal(reviewMain({...p,trunk:' \n ',criticalPoints:[]}).status,'missing-trunk');
});

test('necessary conditions expand the budget without deleting or truncating them',()=>{
 const risk='必须验证这一必要条件。'.repeat(50);
 const p=validatePresentation({...compact,trunk:`建议试点。${risk}`,criticalPoints:[risk]});
 const review=reviewMain(p);assert.ok(review.limit>420);assert.equal(review.status,'accepted');
 assert.equal(confirmPresentation(p,p.trunk).trunk,p.trunk);
 assert.equal(reviewMain(validatePresentation({...p,trunk:'建议试点。'})).status,'missing-critical-points');
});

test('an overlong first draft is not published, and one revision can pass before delivery',async t=>{
 const {r,key,event}=await fixture(t);const rejected=await r.stage(key,[],long);
 assert.equal(rejected.prepared,false);assert.equal(rejected.review.status,'revise');
 assert.equal((await r.turn(key)).presentation,null);await assert.rejects(r.detail(key,'steps'));
 const accepted=await r.stage(key,[],compact);assert.equal(accepted.prepared,true);assert.equal(accepted.review.status,'accepted');
 const answer=`${compact.trunk}\n\n可展开：实施\n\n[展开细节与知识点](http://127.0.0.1:1234/?token=test)`;
 await r.stop({...event,last_assistant_message:answer});
 assert.equal((await r.status(key)).presentation.trunk,compact.trunk);
 assert.equal((await r.status(key)).turn.lengthReview.status,'accepted');
});

test('two failed drafts fall back without a loop, retaining normal visible evidence counting',async t=>{
 const {r,key,event}=await fixture(t);const c={id:'security/authorization',name:'访问权限',evidence:critical};await r.context(key,[c]);
 assert.equal((await r.stage(key,[c],long)).prepared,false);
 const fallback=await r.stage(key,[c],long);assert.equal(fallback.prepared,true);assert.equal(fallback.review.status,'fallback');assert.deepEqual(fallback.detailTitles,[]);
 const retry=await r.stage(key,[c],compact);assert.equal(retry.review.status,'fallback');
 await r.stop({...event,last_assistant_message:critical});
 assert.equal((await r.status(key)).presentation,null);assert.equal((await r.store.list('local')).concepts[0].explanationCount,1);
});

test('extra explanation around an approved main answer invalidates detail publication',async t=>{
 const {r,key,event}=await fixture(t);await r.stage(key,[],compact);
 await r.stop({...event,last_assistant_message:`补充一大段不属于获批主干的文字。\n${compact.trunk}`});
 assert.equal((await r.status(key)).presentation,null);
 assert.equal((await r.status(key)).turn.lengthReview.status,'delivery-mismatch');
});

test('legacy calls stay compatible and explicit detailed requests bypass progressive review',async t=>{
 const {r,key}=await fixture(t);const old={...compact,reviewTrunk:undefined};
 assert.equal(reviewMain(old),null);assert.equal((await r.stage(key,[],old)).prepared,true);
 await r.context(key,[],[],{overrides:{verbosity:'detailed'}});
 await assert.rejects(r.stage(key,[],compact),/disabled/);
 assert.equal((await r.stage(key,[])).prepared,true);
});
