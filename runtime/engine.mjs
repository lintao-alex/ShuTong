import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { SqliteKnowledgeStore, InformationRegistry } from '../packages/user-information/dist/index.js';
import { evaluateOutput, knowledgePolicy } from '../packages/output/dist/index.js';

export function dataDirectory() {
  if (process.env.SHUTONG_DATA_DIR) return resolve(process.env.SHUTONG_DATA_DIR);
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'ShuTong');
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'ShuTong');
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'shutong');
}
export const digest = value => createHash('sha256').update(value).digest('hex');
const normalize = value => value.normalize('NFKC').replace(/\s+/g, ' ').trim();
const validKey = key => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key);
export async function atomicJson(path, data) {
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
  await rename(temporary, path);
}
export async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export class Runtime {
  constructor(directory, store) { this.directory = directory; this.store = store; }
  static async open(directory = dataDirectory()) {
    await mkdir(join(directory, 'turns'), { recursive: true, mode: 0o700 });
    return new Runtime(directory, new SqliteKnowledgeStore(join(directory, 'knowledge.sqlite')));
  }
  close() { this.store.close(); }
  path(key) {
    if (!validKey(key)) throw new Error('Invalid ShuTong turn key');
    return join(this.directory, 'turns', `${key}.json`);
  }
  async turn(key) {
    const state = await readJson(this.path(key));
    if (!state || Date.now() - state.createdAt > 86400000) throw new Error('ShuTong turn missing or expired; start a new user turn with hooks enabled');
    return state;
  }
  async start(event) {
    if (typeof event.session_id !== 'string' || typeof event.turn_id !== 'string') throw new Error('Missing Codex turn identifiers');
    const key = digest(JSON.stringify([event.session_id, event.turn_id]));
    const state = { key, sessionId: event.session_id, turnId: event.turn_id, createdAt: Date.now(), phase: 'ready', staged: [], conceptIds: [] };
    await atomicJson(this.path(key), state);
    // Expire transient snippets; keep no complete prompts or answers.
    for (const name of await readdir(join(this.directory, 'turns'))) {
      if (!/^[a-f0-9]{64}\.json$/.test(name) || name === `${key}.json`) continue;
      const file = join(this.directory, 'turns', name);
      const old = await readJson(file);
      if (old && Date.now() - old.createdAt > 86400000) await rm(file, { force: true });
    }
    return state;
  }
  async context(key, concepts, explainIds = []) {
    const state = await this.turn(key);
    if (state.phase === 'interrupted') throw new Error('Turn interrupted');
    const all = await this.store.list('local');
    // Reuse matching display names; IDs are otherwise domain-specific stable names supplied by the model.
    const resolved = concepts.map(concept => {
      const existing = all.concepts.find(c => c.conceptId === concept.id || normalize(c.name).toLowerCase() === normalize(concept.name).toLowerCase());
      return { ...concept, id: existing?.conceptId ?? concept.id };
    });
    const registry = new InformationRegistry();
    registry.register('knowledge', this.store);
    const requested = resolved.filter((c, i) => explainIds.includes(concepts[i].id)).map(c => c.id);
    const plan = await evaluateOutput(knowledgePolicy, { userId: 'local', conceptIds: resolved.map(c => c.id), explainConceptIds: requested }, registry);
    state.contextRead = true;
    state.allowedConceptIds = [...new Set([...(state.allowedConceptIds ?? []), ...resolved.map(c => c.id)])];
    await atomicJson(this.path(key), state);
    return { threshold: all.threshold, concepts: resolved.map((c, i) => ({ ...c, ...plan.concepts.find(p => p.conceptId === c.id),
      count: all.concepts.find(record => record.conceptId === c.id)?.explanationCount ?? 0 })),
      preserveCriticalInformation: true,
      instruction: 'suppress-basics: omit repeated definitions and beginner examples. Explicit current questions and task-specific risks always take priority.' };
  }
  async stage(key, concepts) {
    const state = await this.turn(key);
    if (state.phase === 'interrupted' || state.phase === 'recorded') throw new Error('Turn already closed');
    if (!state.contextRead && concepts.length) throw new Error('Call context before staging concepts');
    if (concepts.some(c => !state.allowedConceptIds?.includes(c.id))) throw new Error('Stage only concepts queried in this turn');
    state.phase = 'staged';
    state.staged = concepts;
    state.conceptIds = concepts.map(c => c.id);
    await atomicJson(this.path(key), state);
    return { prepared: true, counted: false, instruction: 'Now output the final answer with these exact explanation snippets. Stop hook checks the actual final answer before counting.' };
  }
  async stop(event) {
    const key = digest(JSON.stringify([event.session_id, event.turn_id]));
    const state = await readJson(this.path(key));
    if (!state || state.phase === 'interrupted' || state.phase === 'recorded') return { recorded: false, reason: state?.phase ?? 'no-turn' };
    const answer = typeof event.last_assistant_message === 'string' ? normalize(event.last_assistant_message) : '';
    if (!answer) return { recorded: false, reason: 'no-answer' };
    const matched = (state.staged ?? []).filter(c => typeof c.evidence === 'string' && normalize(c.evidence).length >= 8 && answer.includes(normalize(c.evidence)));
    const mentioned = (state.staged ?? []).filter(c => matched.includes(c) || answer.toLowerCase().includes(normalize(c.name).toLowerCase()));
    await this.store.recordDelivered({ userId: 'local', hostId: 'codex', sessionId: state.sessionId,
      requestId: state.turnId, responseId: digest(answer), explainedConceptIds: matched.map(c => c.id), mentionedConceptIds: mentioned.map(c => c.id) });
    for (const c of mentioned) await this.store.setName('local', c.id, c.name);
    state.phase = state.phase === 'staged' ? 'recorded' : 'not-staged';
    state.explainedIds = matched.map(c => c.id);
    state.conceptIds = mentioned.map(c => c.id);
    state.missingEvidenceCount = (state.staged ?? []).filter(c => c.evidence && !matched.includes(c)).length;
    state.staged = []; // Delete transient literal snippets immediately after checking.
    state.completedAt = Date.now();
    await atomicJson(this.path(key), state);
    return { recorded: state.phase === 'recorded', explainedIds: state.explainedIds, missingEvidenceCount: state.missingEvidenceCount };
  }
  async interrupt(event) {
    const key = digest(JSON.stringify([event.session_id, event.turn_id]));
    const state = await readJson(this.path(key));
    if (state && state.phase !== 'recorded') { state.phase = 'interrupted'; state.staged = []; await atomicJson(this.path(key), state); }
  }
  async status(key) {
    const state = key ? await this.turn(key) : null;
    const info = state ? await this.store.read({ userId: 'local', conceptIds: state.conceptIds }) : await this.store.list('local');
    return { ...info, turn: state ? { phase: state.phase, contextRead: !!state.contextRead, explainedIds: state.explainedIds ?? [], missingEvidenceCount: state.missingEvidenceCount ?? 0 } : null };
  }
}
