import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Runtime } from '../runtime/engine.mjs';
import { InformationRegistry } from '../packages/user-information/dist/index.js';
import { evaluateOutput, knowledgePolicy } from '../packages/output/dist/index.js';

const concept = { id: 'computer/hash-table', name: '哈希表' };
const evidence = '哈希表通过哈希函数把键映射到桶来存取值。';
const event = (turn = 'first') => ({ session_id: 'fixture-session', turn_id: turn });
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'shutong-runtime-'));
  const runtime = await Runtime.open(dir);
  t.after(async () => { runtime.close(); await rm(dir, { recursive: true, force: true }); });
  return runtime;
}

test('one verified explanation causes next-turn suppression; explicit follow-up overrides it', async t => {
  const runtime = await fixture(t);
  const first = await runtime.start(event());
  assert.equal((await runtime.context(first.key, [concept])).concepts[0].mode, 'normal');
  await runtime.stage(first.key, [{ ...concept, evidence }]);
  assert.equal((await runtime.status()).concepts.length, 0, 'staging must never count');
  await runtime.stop({ ...event(), last_assistant_message: evidence });
  const second = await runtime.start(event('second'));
  assert.equal((await runtime.context(second.key, [concept])).concepts[0].mode, 'suppress-basics');
  assert.equal((await runtime.context(second.key, [concept], [concept.id])).concepts[0].mode, 'explain-on-request');
  assert.equal((await runtime.status()).concepts[0].explanationCount, 1);
  assert.deepEqual((await runtime.turn(first.key)).staged, [], 'no snippet retained after verification');
});

test('a staged explanation absent from the actual answer is never counted', async t => {
  const runtime = await fixture(t);
  const first = await runtime.start(event());
  await runtime.context(first.key, [concept]);
  await runtime.stage(first.key, [{ ...concept, evidence }]);
  await runtime.stop({ ...event(), last_assistant_message: '这里可使用哈希表。' });
  assert.equal((await runtime.status()).concepts[0].explanationCount, 0);
  assert.equal((await runtime.status(first.key)).turn.missingEvidenceCount, 1);
});

test('interrupted turn cannot later be staged or counted; other sessions are unaffected', async t => {
  const runtime = await fixture(t);
  const first = await runtime.start(event());
  await runtime.context(first.key, [concept]);
  await runtime.stage(first.key, [{ ...concept, evidence }]);
  await runtime.interrupt(event());
  await runtime.stop({ ...event(), last_assistant_message: evidence });
  assert.equal((await runtime.status()).concepts.length, 0);
  await assert.rejects(runtime.stage(first.key, [{ ...concept, evidence }]), /closed/);
});

test('repeated Stop and same-turn regeneration count once and normalize whitespace', async t => {
  const runtime = await fixture(t);
  for (let i = 0; i < 2; i++) {
    const first = await runtime.start(event());
    await runtime.context(first.key, [concept]);
    await runtime.stage(first.key, [{ ...concept, evidence: 'A hash table maps keys to buckets.' }]);
    await runtime.stop({ ...event(), last_assistant_message: 'A hash table maps\nkeys to buckets.' });
  }
  assert.equal((await runtime.status()).concepts[0].explanationCount, 1);
});

test('matching display name reuses canonical ID and foreign turn keys are rejected', async t => {
  const runtime = await fixture(t);
  await runtime.store.setName('local', concept.id, concept.name);
  await runtime.store.setKnown('local', concept.id, true);
  const first = await runtime.start(event());
  const info = await runtime.context(first.key, [{ id: 'different-id', name: concept.name }], ['different-id']);
  assert.equal(info.concepts[0].id, concept.id);
  assert.equal(info.concepts[0].mode, 'explain-on-request');
  await assert.rejects(runtime.stage(first.key, [{ ...concept, id: 'unqueried', evidence }]), /queried/);
  await assert.rejects(runtime.turn('../escape'), /Invalid/);
});

test('failed knowledge read yields normal explanations while retaining critical-information policy', async () => {
  const information = new InformationRegistry();
  information.register('knowledge', { async read() { throw new Error('offline'); } });
  const result = await evaluateOutput(knowledgePolicy, { userId: 'local', conceptIds: [concept.id], explainConceptIds: [] }, information);
  assert.equal(result.concepts[0].mode, 'normal');
  assert.equal(result.preserveCriticalInformation, true);
});
