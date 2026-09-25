import type { InformationProvider, InformationQuery, InformationReader, InformationResult } from '@shutong/contracts';

export { SqliteKnowledgeStore } from './sqlite-store.js';

/** In-process provider registry, not a profile database or plugin loader. */
export class InformationRegistry<M extends object> implements InformationReader<M> {
  private readonly providers = new Map<string, InformationProvider<unknown>>();

  register<K extends keyof M & string>(key: K, provider: InformationProvider<M[K]>): void {
    if (this.providers.has(key)) throw new Error(`Information provider already registered: ${key}`);
    this.providers.set(key, provider);
  }

  async read<K extends keyof M & string>(key: K, query: InformationQuery): Promise<InformationResult<M[K]>> {
    const provider = this.providers.get(key);
    if (!provider) return { status: 'unavailable', reason: 'not-registered' };
    try {
      // The only cast is at the heterogeneous map boundary; register enforces M[K].
      // Host inputs must be validated before a production provider returns them.
      return { status: 'available', value: await provider.read(query) as M[K] };
    } catch {
      return { status: 'unavailable', reason: 'read-failed' };
    }
  }
}
