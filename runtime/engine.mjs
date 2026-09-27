import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { SqliteKnowledgeStore, InformationRegistry } from '../packages/user-information/dist/index.js';
import { evaluateOutput, knowledgePolicy } from '../packages/output/dist/index.js';
import { validatePresentation, detailPath, progressiveInstructions, confirmPresentation, reviewMain } from './presentation.mjs';
import { ConfigStore, presentationPolicy, overridesSchema } from './config.mjs';

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
  constructor(directory, store, config) { this.directory = directory; this.store = store; this.config = config; }
  static async open(directory = dataDirectory()) {
    await mkdir(join(directory, 'turns'), { recursive: true, mode: 0o700 });
    return new Runtime(directory, new SqliteKnowledgeStore(join(directory, 'knowledge.sqlite')), new ConfigStore(join(directory,'settings.sqlite')));
  }
  close() { this.store.close(); this.config.close(); }
  effective(state={}) { return this.config.resolve({domain:state.domain,sessionId:state.sessionId,overrides:state.overrides}); }
  recording(state) { const c=this.effective(state);return c.enabled&&c.profileEnabled&&c.autoRecord; }
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
    // Expire selected answer fragments; never read the conversation transcript.
    for (const name of await readdir(join(this.directory, 'turns'))) {
      if (!/^[a-f0-9]{64}\.json$/.test(name) || name === `${key}.json`) continue;
      const file = join(this.directory, 'turns', name);
      const old = await readJson(file);
      if (old && Date.now() - old.createdAt > 86400000) await rm(file, { force: true });
    }
    return state;
  }
  async context(key, concepts, explainIds = [], options = {}) {
    const state = await this.turn(key);
    if (state.phase === 'interrupted') throw new Error('Turn interrupted');
    if (options.domain!==undefined) { if(typeof options.domain!=='string'||options.domain.length>160)throw new Error('Invalid domain');state.domain=options.domain; }
    if(options.overrides!==undefined)state.overrides=overridesSchema.parse(options.overrides);
    const config=this.effective(state);
    const useProfile=config.enabled&&config.profileEnabled&&config.adaptiveResponse;
    const resolved = useProfile ? await this.store.resolveNames('local',concepts,state.domain??'') : concepts;
    const all = useProfile ? await this.store.read({userId:'local',conceptIds:resolved.map(c=>c.id)}) : {threshold:1,concepts:[]};
    const candidates = new Map();
    let candidateBudget = 12;
    if (useProfile) for (const [index,c] of resolved.entries()) {
      if (!candidateBudget || all.concepts.some(record=>record.conceptId===c.id)) continue;
      const matches = (await this.store.findNameCandidates('local',c.name,c.id)).slice(0,candidateBudget);
      candidateBudget -= matches.length;
      if(matches.length)candidates.set(index,matches);
    }
    const registry = new InformationRegistry();
    registry.register('knowledge', useProfile&&config.suppressKnownConcepts ? this.store : {async read(){return {threshold:1,concepts:[]};}});
    const requested = resolved.filter((c, i) => config.verbosity==='detailed'||explainIds.includes(concepts[i].id)).map(c => c.id);
    const plan = await evaluateOutput(knowledgePolicy, { userId: 'local', conceptIds: resolved.map(c => c.id), explainConceptIds: requested }, registry);
    state.contextRead = true;
    state.allowedConceptIds = [...new Set([...(state.allowedConceptIds ?? []), ...resolved.map(c => c.id), ...[...candidates.values()].flat().map(c=>c.conceptId)])];
    await atomicJson(this.path(key), state);
    return { threshold: all.threshold, concepts: resolved.map((c, i) => ({ ...c, ...plan.concepts.find(p => p.conceptId === c.id),
      count: all.concepts.find(record => record.conceptId === c.id)?.explanationCount ?? 0,
      ...(candidates.has(i)?{candidates:candidates.get(i).map(record=>({
        id:record.conceptId,name:record.name,count:record.explanationCount,
        domainHint:record.conceptId.split(/[/.]/).slice(0,-1).join('/')||null,
        mode:requested.includes(c.id)?'explain-on-request':config.suppressKnownConcepts&&(record.manuallyKnown||record.explanationCount>=all.threshold)?'suppress-basics':'normal',
      }))}:{}) })),
      preserveCriticalInformation: true,
      config, presentationPolicy: presentationPolicy(config),
      presentationInstruction: config.enabled && config.progressiveDetails && config.verbosity !== 'detailed' ? progressiveInstructions : 'Progressive details are disabled for this answer. Deliver the requested answer directly; obey the returned format and media constraints.',
      instruction: 'suppress-basics: omit repeated definitions and beginner examples. Explicit questions and task risks take priority.' + (candidates.size ? ' Candidates are lexical alternatives, NOT automatic matches: only if clearly the same intended concept, use its canonical id, name and mode for this answer and stage (no extra lookup needed). Otherwise keep the original normal concept; do not choose a candidate merely because it is known. Never merge unrelated homonyms.' : '') };
  }
  async stage(key, concepts, presentation) {
    const state = await this.turn(key);
    if (state.phase === 'interrupted' || state.phase === 'recorded') throw new Error('Turn already closed');
    if (!state.contextRead && concepts.length) throw new Error('Call context before staging concepts');
    if (concepts.some(c => !state.allowedConceptIds?.includes(c.id))) throw new Error('Stage only concepts queried in this turn');
    const config=this.effective(state);
    let prepared = validatePresentation(presentation);
    if(prepared&&(!config.enabled||!config.progressiveDetails||config.verbosity==='detailed'))throw new Error('Progressive presentation is disabled for this answer; deliver the requested text directly');
    if (prepared?.details.some(node => node.concepts.some(c => !state.allowedConceptIds?.includes(c.id)))) throw new Error('Query detail concepts before staging');
    let review = prepared ? reviewMain(prepared) : null;
    if (state.lengthReviewFallback || (review && review.status !== 'accepted')) {
      state.lengthReviewAttempts = (state.lengthReviewAttempts ?? 0) + 1;
      state.lengthReview = review;
      state.presentation = null;
      state.staged = [];
      if (state.lengthReviewAttempts < 2 && !state.lengthReviewFallback) {
        state.phase = 'ready';
        await atomicJson(this.path(key), state);
        return { prepared:false, counted:false, review, detailTitles:[],
          instruction:'Revise the trunk ONCE: include every missingCriticalPoint and fit the returned limit. Keep criticalPoints and each detail.requiredInTrunk; never erase declarations to pass. Move secondary steps out, never necessary conditions. Resubmit stage; nothing has been published or counted.' };
      }
      state.lengthReviewFallback = true;
      review = {...review,status:'fallback'};
      prepared = null;
    }
    state.lengthReview = review;
    state.phase = 'staged';
    state.staged = concepts;
    state.conceptIds = concepts.map(c => c.id);
    state.presentation = prepared;
    await atomicJson(this.path(key), state);
    return { prepared: true, counted: false, review, detailTitles: prepared?.details.map(n => n.title) ?? [],
      instruction: state.lengthReviewFallback
        ? 'No more revision calls. Answer directly, retain all essential conditions, and offer text follow-up topics if useful. No details were published; do not claim a detail panel is available. Staged visible knowledge can still be counted.'
        : prepared ? (prepared.trunk
        ? 'Deliver ONLY the supplied trunk verbatim. Do not add a second introduction, explanation or conclusion. Optionally add a line beginning 可展开： listing detail titles, then the panel link alone on the final line.'
        : 'Now write ONLY the compact main answer: aim for 150–400 Chinese characters or 100–200 English words, allowing extra space only for essential conditions. Include every criticalPoint. Implementation steps and full comparisons are already in details: do not repeat them. End with optional detail titles and the panel link on its own line.')
        : 'Output the answer with the exact staged evidence; Stop verifies it before counting.' };
  }
  async stop(event) {
    const key = digest(JSON.stringify([event.session_id, event.turn_id]));
    const state = await readJson(this.path(key));
    if (!state || state.phase === 'interrupted' || state.phase === 'recorded') return { recorded: false, reason: state?.phase ?? 'no-turn' };
    const answer = typeof event.last_assistant_message === 'string' ? normalize(event.last_assistant_message) : '';
    if (!answer) return { recorded: false, reason: 'no-answer' };
    const matched = this.recording(state) ? (state.staged ?? []).filter(c => typeof c.evidence === 'string' && normalize(c.evidence).length >= 8 && answer.includes(normalize(c.evidence))) : [];
    const mentioned = (state.staged ?? []).filter(c => matched.includes(c) || answer.toLowerCase().includes(normalize(c.name).toLowerCase()));
    if(this.recording(state))await this.store.recordDelivered({ userId: 'local', hostId: 'codex', sessionId: state.sessionId,
      requestId: state.turnId, responseId: digest(answer), explainedConceptIds: matched.map(c => c.id), mentionedConceptIds: mentioned.map(c => c.id) });
    if(this.recording(state))for (const c of mentioned) await this.store.setName('local', c.id, c.name);
    state.phase = state.phase === 'staged' ? 'recorded' : 'not-staged';
    state.explainedIds = matched.map(c => c.id);
    state.conceptIds = mentioned.map(c => c.id);
    state.missingEvidenceCount = this.recording(state) ? (state.staged ?? []).filter(c => c.evidence && !matched.includes(c)).length : 0;
    state.recordingEnabled = this.recording(state);
    state.staged = []; // Delete transient literal snippets immediately after checking.
    state.completedAt = Date.now();
    state.presentation = confirmPresentation(state.presentation, event.last_assistant_message);
    state.presentationVerified = !!state.presentation;
    if (state.lengthReview?.status === 'accepted' && !state.presentationVerified) {
      state.lengthReview = {...state.lengthReview,status:'delivery-mismatch'};
    }
    await atomicJson(this.path(key), state);
    return { recorded: state.phase === 'recorded', explainedIds: state.explainedIds, missingEvidenceCount: state.missingEvidenceCount };
  }
  async interrupt(event) {
    const key = digest(JSON.stringify([event.session_id, event.turn_id]));
    const state = await readJson(this.path(key));
    if (state && state.phase !== 'recorded') { state.phase = 'interrupted'; state.staged = []; state.presentation = null; await atomicJson(this.path(key), state); }
  }
  async detail(key, id) {
    const state = await this.turn(key);
    if (!state.presentationVerified || !state.presentation) throw new Error('Answer details are not confirmed or have expired');
    return detailPath(state.presentation, id);
  }
  async viewedDetail(key, id) {
    const state = await this.turn(key);
    await this.detail(key, id);
    const node = state.presentation.details.find(node => node.id === id);
    const concepts = node.concepts.filter(c => normalize(c.evidence).length >= 8 && normalize(node.body).includes(normalize(c.evidence)));
    if(this.recording(state))await this.store.recordDelivered({ userId: 'local', hostId: 'codex', sessionId: state.sessionId, requestId: state.turnId,
      responseId: `detail:${id}`, explainedConceptIds: concepts.map(c => c.id), mentionedConceptIds: concepts.map(c => c.id) });
    if(this.recording(state))for (const c of concepts) await this.store.setName('local', c.id, c.name);
    state.conceptIds=[...new Set([...state.conceptIds,...concepts.map(c=>c.id)])];
    await atomicJson(this.path(key),state);
    return { viewed: true };
  }
  async saveTakeaway(key, id, takeaway) {
    await this.detail(key, id);
    if (typeof takeaway !== 'string' || !takeaway.trim() || takeaway.length > 2000) throw new Error('Takeaway must contain 1–2000 characters');
    const state = await this.turn(key);
    state.takeaways = { ...state.takeaways, [id]: takeaway };
    await atomicJson(this.path(key), state);
    return { nodeId: id, takeaway };
  }
  async clearDetails(){
    for(const name of await readdir(join(this.directory,'turns'))){
      if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
      const path=join(this.directory,'turns',name),state=await readJson(path);
      if(state){state.presentation=null;state.presentationVerified=false;state.staged=[];state.takeaways={};await atomicJson(path,state);}
    }
  }
  async clearProfile(){
    await this.store.clearProfile('local');
    for(const name of await readdir(join(this.directory,'turns')))if(/^[a-f0-9]{64}\.json$/.test(name))await rm(join(this.directory,'turns',name),{force:true});
  }
  async status(key) {
    const state = key ? await this.turn(key) : null;
    const info = state ? await this.store.read({ userId: 'local', conceptIds: state.conceptIds }) : await this.store.list('local');
    return { ...info, config:this.effective(state??{}), globalConfig:this.config.resolve(),configOverrides:this.config.list(), presentation: state?.presentationVerified ? { trunk: state.presentation.trunk, criticalPoints: state.presentation.criticalPoints,
      details: state.presentation.details.map(({id,title,parentId}) => ({id,title,parentId})), takeaways: state.takeaways ?? {} } : null,
      turn: state ? { phase: state.phase, contextRead: !!state.contextRead, explainedIds: state.explainedIds ?? [], missingEvidenceCount: state.missingEvidenceCount ?? 0, lengthReview:state.lengthReview ?? null } : null };
  }
}
