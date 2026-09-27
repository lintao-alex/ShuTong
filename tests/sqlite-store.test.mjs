import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { SqliteKnowledgeStore, InformationRegistry } from '../packages/user-information/dist/index.js';
import { DEFAULT_EXPLANATION_THRESHOLD } from '../packages/contracts/dist/index.js';

const userId = 'test-user';
const event = (patch = {}) => ({
  userId, hostId: 'test-host', sessionId: 'test-session', requestId: 'request-1', responseId: 'response-1',
  explainedConceptIds: ['hash-table'], mentionedConceptIds: ['hash-table'], ...patch,
});
const query = { userId, conceptIds: ['hash-table'] };
const count = async store => (await store.read(query)).concepts[0]?.explanationCount ?? 0;

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'shutong-store-test-'));
  const filename = join(directory, 'profile.sqlite');
  const stores = [];
  const open = () => { const store = new SqliteKnowledgeStore(filename); stores.push(store); return store; };
  t.after(async () => { for (const store of stores) store.close(); await rm(directory, { recursive: true, force: true }); });
  return { filename, open, store: open() };
}

test('new profiles default to one explanation; a mention alone does not increment', async t => {
  const { store } = await fixture(t);
  assert.equal(DEFAULT_EXPLANATION_THRESHOLD, 1);
  assert.deepEqual(await store.read(query), { threshold: 1, concepts: [] });
  await store.recordDelivered(event({ explainedConceptIds: [] }));
  assert.equal(await count(store), 0);
  await store.recordDelivered(event());
  assert.equal(await count(store), 1);
  assert.equal((await store.read(query)).threshold, 1);
});

test('retries, duplicate concepts and regenerated responses count once per logical request', async t => {
  const { store } = await fixture(t);
  await store.recordDelivered(event({ explainedConceptIds: ['hash-table', 'hash-table'] }));
  await store.recordDelivered(event());
  await store.recordDelivered(event({ responseId: 'regenerated' }));
  assert.equal(await count(store), 1);
  await store.recordDelivered(event({ requestId: 'new-request' }));
  assert.equal(await count(store), 2);
  assert.equal((await store.exportProfile(userId)).receipts.length, 2);
});

test('profiles persist across reopen, with custom thresholds and manual settings preserved', async t => {
  const { store, open } = await fixture(t);
  await store.recordDelivered(event());
  await store.setName(userId, 'hash-table', '哈希表');
  await store.setKnown(userId, 'hash-table', true);
  await store.setThreshold(userId, 3);
  store.close();
  const reopened = open();
  assert.deepEqual(await reopened.read(query), { threshold: 3, concepts: [{
    conceptId: 'hash-table', name: '哈希表', explanationCount: 1, manuallyKnown: true,
  }] });
  await reopened.recordDelivered(event());
  assert.equal(await count(reopened), 1);
  await reopened.recordDelivered(event({ sessionId: 'next-session' }));
  assert.equal(await count(reopened), 2);
});

test('manual mark does not invent counts; unchecking resets without replaying old receipts', async t => {
  const { store, open } = await fixture(t);
  await store.setKnown(userId, 'hash-table', true);
  assert.equal(await count(store), 0);
  await store.recordDelivered(event());
  assert.equal((await store.read(query)).concepts[0].manuallyKnown, true);
  await store.setKnown(userId, 'hash-table', false);
  store.close();
  const reopened = open();
  await reopened.recordDelivered(event({ responseId: 'late-retry' }));
  assert.equal(await count(reopened), 0);
  assert.equal((await reopened.read(query)).concepts[0].manuallyKnown, false);
  await reopened.recordDelivered(event({ requestId: 'after-reset' }));
  assert.equal(await count(reopened), 1);
});

test('threshold changes and count corrections do not rewrite other profile state', async t => {
  const { store } = await fixture(t);
  await store.recordDelivered(event());
  await store.setKnown(userId, 'hash-table', true);
  await store.setThreshold(userId, 5);
  await store.setExplanationCount(userId, 'hash-table', 4);
  assert.equal((await store.read(query)).threshold, 5);
  assert.equal((await store.read(query)).concepts[0].manuallyKnown, true);
  await store.recordDelivered(event());
  assert.equal(await count(store), 4);
  for (const threshold of [0, -1, 1.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(store.setThreshold(userId, threshold), /safe integer/);
  }
  assert.equal((await store.read(query)).threshold, 5);
});

test('queries are scoped and concept/user identities are independent', async t => {
  const { store } = await fixture(t);
  await store.recordDelivered(event({ explainedConceptIds: ['hash-table', 'hash-conflicts'] }));
  await store.recordDelivered(event({ userId: 'another-user' }));
  const selected = await store.read({ userId, conceptIds: ['hash-table', 'hash-table', 'unknown'] });
  assert.deepEqual(selected.concepts.map(c => c.conceptId), ['hash-table']);
  assert.equal((await store.read({ userId, conceptIds: [] })).concepts.length, 0);
  await store.clearProfile('another-user');
  assert.equal(await count(store), 1);
  assert.equal((await store.list('another-user')).concepts.length, 0);
});

test('IDs are bound parameters and input validation rejects malformed events without partial state', async t => {
  const { store } = await fixture(t);
  for (const invalid of [null, {}, event({ userId: '' }), event({ requestId: 1 }),
    event({ explainedConceptIds: 'hash-table' }), event({ mentionedConceptIds: ['valid', null] })]) {
    await assert.rejects(store.recordDelivered(invalid), TypeError);
  }
  assert.deepEqual(await store.list(userId), { threshold: 1, concepts: [] });
  const id = "name'); DROP TABLE concepts; --";
  await store.setName(userId, id, '安全的显示名称');
  assert.equal((await store.read({ userId, conceptIds: [id] })).concepts[0].name, '安全的显示名称');
});

test('a failed multi-concept transaction rolls back both increments and retry receipts', async t => {
  const { store } = await fixture(t);
  await store.setExplanationCount(userId, 'hash-table', Number.MAX_SAFE_INTEGER);
  const delivery = event({ explainedConceptIds: ['new-concept', 'hash-table'] });
  await assert.rejects(store.recordDelivered(delivery));
  assert.deepEqual((await store.list(userId)).concepts.map(c => c.conceptId), ['hash-table']);
  assert.equal((await store.exportProfile(userId)).receipts.length, 0);
  await store.setExplanationCount(userId, 'hash-table', 0);
  await store.recordDelivered(delivery);
  assert.equal(await count(store), 1);
  assert.equal((await store.read({ userId, conceptIds: ['new-concept'] })).concepts[0].explanationCount, 1);
});

test('export/import preserves configuration, names, reset counters and replay protection', async t => {
  const { store } = await fixture(t);
  await store.recordDelivered(event());
  await store.setThreshold(userId, 3);
  await store.setName(userId, 'hash-table', '哈希表');
  await store.setKnown(userId, 'hash-table', false);
  const snapshot = JSON.parse(JSON.stringify(await store.exportProfile(userId)));
  assert.equal('userId' in snapshot, false);
  assert.equal('text' in snapshot, false);
  await store.importProfile('restored-user', snapshot);
  await store.recordDelivered(event({ userId: 'restored-user' }));
  assert.deepEqual(await store.exportProfile('restored-user'), snapshot);
  await assert.rejects(store.importProfile('restored-user', snapshot), /replacement must be explicit/);
  await store.setExplanationCount('restored-user', 'hash-table', 6);
  await store.importProfile('restored-user', snapshot, true);
  assert.deepEqual(await store.exportProfile('restored-user'), snapshot);
});

test('invalid snapshots cannot destroy an existing profile even with replace enabled', async t => {
  const { store } = await fixture(t);
  await store.recordDelivered(event());
  const before = await store.exportProfile(userId);
  for (const invalid of [
    null, { ...before, version: 2 }, { ...before, threshold: 0 },
    { ...before, concepts: [before.concepts[0], before.concepts[0]] },
    { ...before, concepts: [{ ...before.concepts[0], manuallyKnown: 'false' }] },
    { ...before, receipts: [{ ...before.receipts[0], conceptId: 'missing' }] },
    { ...before, receipts: [before.receipts[0], before.receipts[0]] },
  ]) {
    await assert.rejects(store.importProfile(userId, invalid, true));
    assert.deepEqual(await store.exportProfile(userId), before);
  }
});

test('clear removes only the chosen profile and resets it to the new default', async t => {
  const { store } = await fixture(t);
  await store.recordDelivered(event());
  await store.setThreshold(userId, 9);
  await store.setKnown('another-user', 'separate', true);
  await store.clearProfile(userId);
  assert.deepEqual(await store.exportProfile(userId), {
    format: 'shutong-knowledge', version: 1, threshold: 1, concepts: [], receipts: [],
  });
  assert.equal((await store.list('another-user')).concepts[0].manuallyKnown, true);
});

test('a closed provider degrades to unavailable without leaking storage errors', async t => {
  const { store } = await fixture(t);
  const registry = new InformationRegistry();
  registry.register('knowledge', store);
  store.close();
  assert.deepEqual(await registry.read('knowledge', query), { status: 'unavailable', reason: 'read-failed' });
});

test('unsupported schema versions and unrelated databases are left unchanged', async t => {
  const { store, filename } = await fixture(t);
  store.close();
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA user_version = 3');
  db.close();
  assert.throws(() => new SqliteKnowledgeStore(filename), /Unsupported/);
  const future = new DatabaseSync(filename);
  assert.equal(future.prepare('PRAGMA user_version').get().user_version, 3);
  future.close();
  const other = `${filename}.other`;
  const foreign = new DatabaseSync(other);
  foreign.exec('CREATE TABLE existing_data(value TEXT); INSERT INTO existing_data VALUES (\'preserve\')');
  foreign.close();
  assert.throws(() => new SqliteKnowledgeStore(other), /non-ShuTong/);
  const unchanged = new DatabaseSync(other);
  assert.equal(unchanged.prepare('SELECT value FROM existing_data').get().value, 'preserve');
  unchanged.close();
});

test('separate processes deduplicate shared requests and preserve all independent increments', { timeout: 20000 }, async t => {
  const { store, filename, open } = await fixture(t);
  store.close();
  const script = fileURLToPath(new URL('./fixtures/write-profile.mjs', import.meta.url));
  const workers = Array.from({ length: 4 }, (_, id) => {
    const child = fork(script, [filename, String(id)], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let errors = '';
    child.stderr.on('data', data => { errors += data; });
    const ready = new Promise((resolve, reject) => {
      child.once('message', message => message === 'ready' ? resolve() : reject(new Error('Unexpected worker message')));
      child.once('error', reject);
      child.once('exit', code => { if (code !== 0) reject(new Error(errors)); });
    });
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(errors)));
    });
    return { child, ready, done };
  });
  // Attach all completion handlers before waiting, so early failures are observed.
  const completed = Promise.all(workers.map(worker => worker.done));
  const started = Promise.all(workers.map(worker => worker.ready)).then(() => {
    for (const worker of workers) worker.child.send('start');
  });
  await Promise.all([started, completed]);
  const reopened = open();
  assert.equal(await count(reopened), 41);
  assert.equal((await reopened.exportProfile(userId)).receipts.length, 41);
});
