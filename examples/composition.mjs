import { InformationRegistry } from '../packages/user-information/dist/index.js';
import { evaluateOutput } from '../packages/output/dist/index.js';
import { parseStopCandidate } from '../packages/host-codex/dist/index.js';
import { DEFAULT_EXPLANATION_THRESHOLD } from '../packages/contracts/dist/index.js';

// Fixture data only. This demo neither infers knowledge nor persists a profile.
const information = new InformationRegistry();
information.register('knowledge', { async read(query) {
  return { threshold: DEFAULT_EXPLANATION_THRESHOLD, concepts: query.conceptIds.map(conceptId => ({
    conceptId, name: '哈希表', explanationCount: 2, manuallyKnown: false,
  })) };
} });
const capability = {
  id: 'fixture-inspection', requires: ['knowledge'],
  async evaluate(context, reader) { return reader.read('knowledge', context); },
};
const context = { userId: 'fixture-user', conceptIds: ['hash-table'], explainConceptIds: [] };
console.log(JSON.stringify({
  mode: 'engineering-demo-only',
  information: await evaluateOutput(capability, context, information),
  hostCandidate: parseStopCandidate({
    hook_event_name: 'Stop', session_id: 'fixture-session', turn_id: 'fixture-turn',
    stop_hook_active: false, last_assistant_message: '这是一条用于验证接口的模拟回答。',
  }),
  usesPersistentStorage: false,
  adaptiveGenerationImplemented: false,
}, null, 2));
