import type { OutputCapability, ShuTongInformation } from '../packages/contracts/dist/index.js';
import { InformationRegistry } from '../packages/user-information/dist/index.js';
import { evaluateOutput } from '../packages/output/dist/index.js';
import { DEFAULT_EXPLANATION_THRESHOLD } from '../packages/contracts/dist/index.js';

// This additional information type exists only to verify the extension contract.
interface FixtureInformation extends ShuTongInformation {
  fixturePreference: { format: string };
}

const information = new InformationRegistry<FixtureInformation>();
information.register('knowledge', {
  async read() { return { threshold: DEFAULT_EXPLANATION_THRESHOLD, concepts: [] }; },
});
information.register('fixturePreference', {
  async read() { return { format: 'text' }; },
});
// @ts-expect-error Providers must return the value type registered for this key.
information.register('fixturePreference', { async read() { return 42; } });
// @ts-expect-error Unknown information keys are not silently accepted.
information.register('missing', { async read() { return {}; } });

const output: OutputCapability<FixtureInformation, string> = {
  id: 'type-fixture', requires: ['knowledge', 'fixturePreference'],
  async evaluate(context, reader) {
    const knowledge = await reader.read('knowledge', context);
    const preference = await reader.read('fixturePreference', context);
    if (knowledge.status === 'unavailable' || preference.status === 'unavailable') return 'fallback';
    return `${knowledge.value.threshold}:${preference.value.format}`;
  },
};
void evaluateOutput(output, {
  userId: 'fixture-user', conceptIds: [], explainConceptIds: [],
}, information);
