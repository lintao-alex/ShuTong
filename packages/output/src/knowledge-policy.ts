import type { OutputCapability, ShuTongInformation } from '@shutong/contracts';

export interface ExplanationPlan {
  readonly preserveCriticalInformation: true;
  readonly concepts: readonly { conceptId: string; mode: 'normal' | 'suppress-basics' | 'explain-on-request' }[];
}

export const knowledgePolicy: OutputCapability<ShuTongInformation, ExplanationPlan> = {
  id: 'adaptive-explanations', requires: ['knowledge'],
  async evaluate(context, information) {
    const result = await information.read('knowledge', context);
    const requested = new Set(context.explainConceptIds);
    const records = new Map(result.status === 'available' ? result.value.concepts.map(record => [record.conceptId, record]) : []);
    return {
      preserveCriticalInformation: true,
      concepts: [...new Set(context.conceptIds)].map(conceptId => {
        if (requested.has(conceptId)) return { conceptId, mode: 'explain-on-request' };
        const record = records.get(conceptId);
        const known = result.status === 'available' && record &&
          (record.manuallyKnown || record.explanationCount >= result.value.threshold);
        return { conceptId, mode: known ? 'suppress-basics' : 'normal' };
      }),
    };
  },
};
