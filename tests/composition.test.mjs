import test from 'node:test';
import assert from 'node:assert/strict';
import { InformationRegistry } from '../packages/user-information/dist/index.js';
import { evaluateOutput } from '../packages/output/dist/index.js';
import { DEFAULT_EXPLANATION_THRESHOLD } from '../packages/contracts/dist/index.js';

const context = {
  userId: 'demo-user', conceptIds: ['hash-table'], explainConceptIds: [],
};

test('one information provider can serve two independent output capabilities', async () => {
  const information = new InformationRegistry();
  const queries = [];
  information.register('knowledge', { async read(query) {
    queries.push(query);
    return { concepts: [{ conceptId: 'hash-table', explanationCount: 2 }], threshold: DEFAULT_EXPLANATION_THRESHOLD };
  } });
  const first = { id: 'fixture-count', requires: ['knowledge'], async evaluate(ctx, reader) {
    const result = await reader.read('knowledge', ctx);
    return result.value.concepts[0].explanationCount;
  } };
  const second = { id: 'fixture-list', requires: ['knowledge'], async evaluate(ctx, reader) {
    const result = await reader.read('knowledge', ctx);
    return result.value.concepts.map(concept => concept.conceptId);
  } };
  assert.equal(await evaluateOutput(first, context, information), 2);
  assert.deepEqual(await evaluateOutput(second, context, information), ['hash-table']);
  assert.equal(queries.length, 2);
  assert.ok(queries.every(query => query.userId === 'demo-user'));
});

test('one capability combines two information types without changing the engines', async () => {
  const information = new InformationRegistry();
  information.register('knowledge', { async read() { return { count: 2 }; } });
  information.register('fixture-preference', { async read() { return { format: 'text' }; } });
  const capability = {
    id: 'fixture-combination', requires: ['knowledge', 'fixture-preference'],
    async evaluate(ctx, reader) {
      const knowledge = await reader.read('knowledge', ctx);
      const preference = await reader.read('fixture-preference', ctx);
      return { count: knowledge.value.count, format: preference.value.format };
    },
  };
  assert.deepEqual(await evaluateOutput(capability, context, information), { count: 2, format: 'text' });
});

test('unrelated information is never read and missing information permits fallback', async () => {
  const information = new InformationRegistry();
  let unrelatedReads = 0;
  information.register('unrelated', { async read() { unrelatedReads += 1; return {}; } });
  const capability = { id: 'fallback', requires: ['knowledge'], async evaluate(ctx, reader) {
    const result = await reader.read('knowledge', ctx);
    return result.status === 'unavailable' ? 'ordinary-answer' : 'adapted-answer';
  } };
  assert.equal(await evaluateOutput(capability, context, information), 'ordinary-answer');
  assert.equal(unrelatedReads, 0);
});

test('reader failure exposes a bounded reason instead of private exception content', async () => {
  const information = new InformationRegistry();
  information.register('knowledge', { async read() { throw new Error('private storage detail'); } });
  assert.deepEqual(await information.read('knowledge', context), { status: 'unavailable', reason: 'read-failed' });
});

test('output cannot read undeclared information or widen user/concept scope', async () => {
  const information = new InformationRegistry();
  let reads = 0;
  information.register('knowledge', { async read() { reads += 1; return {}; } });
  for (const [key, query, message] of [
    ['private-info', context, /Undeclared/],
    ['knowledge', { ...context, userId: 'another-user' }, /scope/],
    ['knowledge', { ...context, conceptIds: ['unrelated'] }, /scope/],
  ]) {
    const capability = { id: 'scope-test', requires: ['knowledge'], async evaluate(_ctx, reader) {
      return reader.read(key, query);
    } };
    await assert.rejects(evaluateOutput(capability, context, information), message);
  }
  assert.equal(reads, 0);
});

test('duplicate provider registration cannot silently replace existing data access', () => {
  const information = new InformationRegistry();
  const provider = { async read() { return {}; } };
  information.register('knowledge', provider);
  assert.throws(() => information.register('knowledge', provider), /already registered/);
});
