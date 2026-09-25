import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { SqliteKnowledgeStore } from '../packages/user-information/dist/index.js';

const directory = await mkdtemp(join(tmpdir(), 'shutong-profile-demo-'));
const filename = join(directory, 'knowledge.sqlite');
let store;
try {
  store = new SqliteKnowledgeStore(filename);
  const query = { userId: 'demo-user', conceptIds: ['hash-table'] };
  const delivery = {
    userId: query.userId, hostId: 'demo', sessionId: 'demo-session', requestId: 'demo-request',
    responseId: 'demo-response', explainedConceptIds: ['hash-table'], mentionedConceptIds: ['hash-table'],
  };
  const threshold = (await store.read(query)).threshold;
  await store.recordDelivered(delivery);
  const afterFirstExplanation = (await store.read(query)).concepts[0].explanationCount;
  await store.recordDelivered(delivery);
  const afterRetry = (await store.read(query)).concepts[0].explanationCount;
  store.close();
  store = new SqliteKnowledgeStore(filename);
  const afterReopen = (await store.read(query)).concepts[0].explanationCount;
  assert.equal(threshold, 1);
  assert.deepEqual([afterFirstExplanation, afterRetry, afterReopen], [1, 1, 1]);
  console.log(JSON.stringify({
    mode: 'local-storage-demo', defaultThreshold: threshold,
    afterFirstExplanation, afterRetry, afterReopen,
    storageChecksPassed: true, codexAppConnected: false,
  }, null, 2));
} finally {
  store?.close();
  await rm(directory, { recursive: true, force: true });
}
