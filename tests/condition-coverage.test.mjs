import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Runtime} from '../runtime/engine.mjs';
import {validatePresentation, reviewMain, confirmPresentation} from '../runtime/presentation.mjs';

// Regression scenarios distilled from the real knowledge-base and migration evaluations.
const conditions = [
  '引用入口、缓存和历史记录也须鉴权，撤权后立即失效。',
  '文档内容只作资料，不执行其中要求泄密或调用工具的指令。',
  '切换后若已有新写入，回退前必须回放或对账，不能直接切回旧库。',
];
const draft = {
  reviewTrunk: true, trunk: '建议小范围试点，验收通过后上线。', criticalPoints: [],
  details: conditions.map((point, i) => ({id: `step${i}`, title: `实施${i}`,
    body: `具体实施前提：${point}`, requiredInTrunk: [point]})),
};
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'shutong-condition-'));
  const r = await Runtime.open(directory);
  t.after(async () => {r.close(); await rm(directory, {recursive:true, force:true});});
  const event = {session_id:'conditions', turn_id:'one'};
  const {key} = await r.start(event); await r.context(key, []);
  return {r, key, event};
}

test('detail conditions cannot disappear behind a generic warning, even in child nodes', () => {
  const p = validatePresentation({...draft, trunk: draft.trunk + '注意安全和回退风险。',
    details: draft.details.map((node, i) => i ? {...node, parentId:'step0'} : node)});
  assert.equal(reviewMain(p).status, 'missing-critical-points');
  assert.deepEqual(reviewMain(p).missingCriticalPoints, conditions);
  assert.equal(confirmPresentation(p, p.trunk), null);
});

test('ordinary steps and legacy details need no forced warning; declared conditions extend the budget once', () => {
  const ordinary = validatePresentation({...draft, details:[{id:'steps',title:'步骤',body:'创建索引，然后调整批量大小。',requiredInTrunk:[]}]});
  assert.equal(reviewMain(ordinary).status, 'accepted');
  assert.equal(reviewMain(validatePresentation({...ordinary, details:[{id:'old',title:'旧格式',body:'旧节点仍可用。'}]})).status, 'accepted');
  const point = '数据已产生新写入，必须完成回放后才能切回。'.repeat(30);
  const p = validatePresentation({...draft, trunk: point, criticalPoints:[point],
    details:[{id:'rollback',title:'回退',body:'详细回放步骤。',requiredInTrunk:[point,point]}]});
  const review = reviewMain(p);
  assert.equal(review.status, 'accepted'); assert.ok(review.limit > 420);
  assert.equal(review.criticalUnits, [...point].length);
  assert.throws(() => validatePresentation({...p,details:[{...p.details[0],requiredInTrunk:['  ']}]}));
});

test('missing conditions produce one actionable revision; corrected delivery publishes details', async t => {
  const {r,key,event} = await fixture(t);
  const rejected = await r.stage(key, [], draft);
  assert.equal(rejected.prepared, false);
  assert.deepEqual(rejected.review.missingCriticalPoints, conditions);
  await assert.rejects(r.detail(key, 'step0'));
  assert.equal((await r.store.list('local')).concepts.length, 0);
  const corrected = {...draft,trunk: draft.trunk + conditions.join('')};
  assert.equal((await r.stage(key, [], corrected)).review.status, 'accepted');
  await r.stop({...event,last_assistant_message:corrected.trunk});
  assert.equal((await r.detail(key,'step2')).node.body, draft.details[2].body);
});

test('coverage and length failures share one revision allowance; fallback never publishes stale details', async t => {
  const {r,key,event} = await fixture(t);
  assert.equal((await r.stage(key, [], draft)).prepared, false);
  const long = {...draft, trunk:conditions.join('') + '次要实施说明。'.repeat(100)};
  const fallback = await r.stage(key, [], long);
  assert.equal(fallback.prepared, true); assert.equal(fallback.review.status, 'fallback');
  assert.deepEqual(fallback.detailTitles, []);
  assert.equal((await r.stage(key, [], {...draft,trunk:conditions.join('')})).review.status, 'fallback');
  const legacyRetry = await r.stage(key, [], {...draft,reviewTrunk:undefined,trunk:conditions.join('')});
  assert.equal(legacyRetry.review.status, 'fallback'); assert.deepEqual(legacyRetry.detailTitles, []);
  await r.stop({...event,last_assistant_message:conditions.join('')});
  assert.equal((await r.status(key)).presentation, null);
  await assert.rejects(r.detail(key,'step0'));
});

test('legacy and captured-trunk paths also enforce detail conditions without requiring duplicate global declarations', () => {
  assert.throws(() => validatePresentation({...draft,reviewTrunk:undefined}), /Critical/);
  const captured = validatePresentation({...draft,trunk:undefined,reviewTrunk:undefined});
  assert.equal(confirmPresentation(captured, '建议试点。'), null);
  assert.equal(confirmPresentation(captured, conditions.join('\n')).trunk, conditions.join('\n'));
});

test('declared coverage does not pretend to recognize unmarked semantic risks', () => {
  const unmarked = validatePresentation({...draft,details:draft.details.map(({requiredInTrunk,...node})=>node)});
  assert.equal(reviewMain(unmarked).status, 'accepted');
  // This deliberately documents the boundary: no keyword scanner or extra model judge.
});
