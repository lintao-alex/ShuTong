import type { InformationQuery, InformationReader, OutputCapability, OutputContext } from '@shutong/contracts';
export { knowledgePolicy } from './knowledge-policy.js';

/** Resolve only declared information, scoped to the current user and concepts. */
export function evaluateOutput<M extends object, Result>(
  capability: OutputCapability<M, Result>,
  context: OutputContext,
  information: InformationReader<M>,
): Promise<Result> {
  const allowed = new Set(capability.requires);
  const conceptIds = new Set(context.conceptIds);
  const scoped: InformationReader<M> = {
    read<K extends keyof M & string>(key: K, query: InformationQuery) {
      if (!allowed.has(key)) throw new Error(`Undeclared information dependency: ${key}`);
      if (query.userId !== context.userId || query.conceptIds.some(id => !conceptIds.has(id))) {
        throw new Error('Information query exceeds the current user or concept scope');
      }
      return information.read(key, query);
    },
  };
  return capability.evaluate(context, scoped);
}
