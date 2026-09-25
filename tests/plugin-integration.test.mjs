import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readJson } from '../runtime/engine.mjs';

test('packaged hook + real MCP transport + panel complete two turns without manual recording', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'shutong-plugin-test-'));
  const main = resolve('plugins/shutong/runtime/main.mjs');
  const mcp = resolve('plugins/shutong/runtime/mcp-server.mjs');
  const env = { ...process.env, SHUTONG_DATA_DIR: directory };
  const hook = input => {
    const result = spawnSync(process.execPath, [main, 'hook'], { env, input: JSON.stringify(input), encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  };
  const client = new Client({ name: 'shutong-integration-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [mcp], env, stderr: 'pipe' }));
  t.after(async () => {
    await client.close();
    const panel = await readJson(join(directory, 'panel.json'));
    if (panel) await fetch(`${panel.url}/shutdown?token=${panel.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  });
  const call = async (name, args) => {
    const response = await client.callTool({ name, arguments: args });
    assert.ok(!response.isError, response.content[0]?.text);
    return JSON.parse(response.content[0].text);
  };
  const input = { session_id: 'test-session', turn_id: 'turn-one', prompt: '介绍哈希表' };
  const start = hook({ ...input, hook_event_name: 'UserPromptSubmit' });
  const turnKey = start.hookSpecificOutput.additionalContext.match(/SHUTONG_TURN=([a-f0-9]{64})/)[1];
  const concept = { id: 'computer/hash-table', name: '哈希表' };
  const before = await call('context', { turnKey, concepts: [concept], explainIds: [concept.id] });
  assert.equal(before.threshold, 1);
  const evidence = '哈希表通过哈希函数把键映射到桶来存取值。';
  const staged = await call('stage', { turnKey, concepts: [{ ...concept, evidence }] });
  assert.equal(staged.counted, false);
  assert.ok(staged.panelUrl, 'panel must start for integration acceptance');
  hook({ ...input, hook_event_name: 'Stop', last_assistant_message: evidence, stop_hook_active: false });
  const recorded = await call('status', { turnKey });
  assert.equal(recorded.concepts[0].explanationCount, 1);
  assert.equal(recorded.turn.phase, 'recorded');
  const next = hook({ ...input, turn_id: 'turn-two', hook_event_name: 'UserPromptSubmit' });
  const secondKey = next.hookSpecificOutput.additionalContext.match(/SHUTONG_TURN=([a-f0-9]{64})/)[1];
  assert.equal((await call('context', { turnKey: secondKey, concepts: [concept] })).concepts[0].mode, 'suppress-basics');
  const url = new URL(staged.panelUrl);
  assert.equal((await fetch(staged.panelUrl)).status, 200);
  assert.equal((await fetch(`${url.origin}/state`)).status, 403);
  const update = await fetch(`${url.origin}/threshold?token=${url.searchParams.get('token')}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url.origin }, body: JSON.stringify({ value: 3 }),
  });
  assert.equal(update.status, 200);
  assert.equal((await call('context', { turnKey: secondKey, concepts: [concept] })).concepts[0].mode, 'normal');
  const forbidden = await fetch(`${url.origin}/known?token=${url.searchParams.get('token')}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.org' }, body: JSON.stringify({ id: concept.id, known: true }),
  });
  assert.equal(forbidden.status, 403);
});
