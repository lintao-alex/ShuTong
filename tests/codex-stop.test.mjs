import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStopCandidate } from '../packages/host-codex/dist/index.js';

// Synthetic fixture based on the official documented wire fields, not a captured turn.
const stop = {
  hook_event_name: 'Stop', session_id: 'fixture-session', turn_id: 'fixture-turn',
  stop_hook_active: false, last_assistant_message: '哈希表通过哈希函数定位键。',
  transcript_path: '/fixture/do-not-read.jsonl',
};

test('Stop input becomes an unverified candidate without copying transcript paths', () => {
  assert.deepEqual(parseStopCandidate(stop), {
    kind: 'answer-candidate', sessionId: 'fixture-session', turnId: 'fixture-turn',
    text: stop.last_assistant_message, continuedByStopHook: false, delivery: 'unverified',
  });
});

test('interruption, subagent, tool events and malformed payloads produce no candidate', () => {
  for (const input of [
    null, [], 'Stop', {},
    ...['Interrupt', 'SubagentStop', 'PostToolUse'].map(hook_event_name => ({ ...stop, hook_event_name })),
    { ...stop, session_id: '' }, { ...stop, turn_id: 42 },
    { ...stop, last_assistant_message: null }, { ...stop, last_assistant_message: ' ' },
    { ...stop, stop_hook_active: undefined },
  ]) assert.equal(parseStopCandidate(input), null);
});

test('a continued Stop stays a candidate and never implies final delivery', () => {
  const candidate = parseStopCandidate({ ...stop, stop_hook_active: true });
  assert.equal(candidate.continuedByStopHook, true);
  assert.equal(candidate.delivery, 'unverified');
});
