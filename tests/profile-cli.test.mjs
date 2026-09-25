import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('CLI records, deduplicates, exports and restores a local profile across processes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'shutong-cli-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('../scripts/profile.mjs', import.meta.url));
  const db = join(directory, 'profile.sqlite');
  const run = (args, input) => spawnSync(process.execPath, [script, '--db', db, ...args], {
    input: input === undefined ? undefined : JSON.stringify(input), encoding: 'utf8', timeout: 10000,
  });
  const ok = (args, input) => {
    const result = run(args, input);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.equal(ok(['status']).threshold, 1);
  const delivery = { hostId: 'cli-test', sessionId: 's', requestId: 'r', responseId: 'a',
    explainedConceptIds: ['hash-table'], mentionedConceptIds: [] };
  assert.equal(ok(['record'], delivery).concepts[0].explanationCount, 1);
  assert.equal(ok(['record'], delivery).concepts[0].explanationCount, 1);
  assert.equal(ok(['threshold', '3']).threshold, 3);
  assert.equal(run(['threshold', '0']).status, 1);
  assert.equal(ok(['get', 'hash-table']).threshold, 3);
  const snapshot = ok(['export']);
  assert.equal(run(['import'], snapshot).status, 1);
  assert.equal(ok(['clear']).threshold, 1);
  ok(['import'], snapshot);
  assert.equal(ok(['record'], delivery).concepts[0].explanationCount, 1);
  ok(['known', 'hash-table', 'false']);
  assert.equal(ok(['record'], delivery).concepts[0].explanationCount, 0);
  assert.equal(run(['record'], { ...delivery, userId: 'someone-else' }).status, 1);
  assert.equal(run(['known', 'hash-table', 'yes']).status, 1);
  assert.equal(run(['status', 'unexpected']).status, 1);
});
