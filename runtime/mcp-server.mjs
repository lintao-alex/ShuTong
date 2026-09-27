import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Runtime } from './engine.mjs';
import { ensurePanel } from './panel.mjs';
import { presentationSchema } from './presentation.mjs';
import { configPatchSchema, scopeSchema, overridesSchema } from './config.mjs';
import { contextResponse } from './wire.mjs';

const runtime = await Runtime.open();
const server = new McpServer({ name: 'shutong', version: '0.1.0' });
const id = z.string().min(1).max(160);
const key = z.string().regex(/^[a-f0-9]{64}$/);
const concept = z.object({ id, name: z.string().min(1).max(160) });
const annotations = { destructiveHint: false, openWorldHint: false, idempotentHint: true };
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

server.registerTool('context', {
  description: 'Read ShuTong knowledge for this turn before composing a substantive answer. Use the SHUTONG_TURN key injected by the hook; preserve returned canonical IDs. For lexical candidates, use a candidate ID/name/mode only if clearly the same intended concept; ambiguous matches remain normal. No extra lookup is needed. verbosity=detailed requires an explicit WHOLE-answer fully expanded/no-fold request; asking for implementation details alone uses normal detail nodes. Does not increment counts.',
  inputSchema: { turnKey: key, concepts: z.array(concept).max(20), explainIds: z.array(id).max(20).default([]), domain:z.string().max(160).optional(), overrides:overridesSchema.optional() }, annotations,
}, async ({ turnKey, concepts, explainIds,domain,overrides }) => result(contextResponse(await runtime.context(turnKey, concepts, explainIds,{domain,overrides}))));

server.registerTool('stage', {
  description: 'Stage before final output. For progressive answers supply presentation.trunk, reviewTrunk:true, criticalPoints and concise details. Review checks length before delivery; if prepared:false revise once. On accepted review deliver only the exact approved trunk and footer. Only explicit whole-answer full/inline/no-fold requests bypass folding. Knowledge evidence is exact visible explanation (8+ chars), empty for mentions; hidden content is not counted.',
  inputSchema: { turnKey: key, concepts: z.array(concept.extend({ evidence: z.string().max(1000) })).max(20), presentation: presentationSchema.optional() }, annotations,
}, async ({ turnKey, concepts, presentation }) => {
  const prepared = await runtime.stage(turnKey, concepts, presentation);
  let panelUrl = null;
  try { if(prepared.prepared && (concepts.length || prepared.detailTitles.length) && runtime.effective(await runtime.turn(turnKey)).panelEnabled)panelUrl = await ensurePanel(runtime.directory, turnKey); } catch { /* Recording must work without UI. */ }
  return result({ prepared: prepared.prepared, counted: false, review:prepared.review, hasDetails:prepared.detailTitles.length>0, instruction:prepared.instruction, panelUrl });
});

server.registerTool('config', {
  description:'Inspect or change ShuTong feature switches only when the user requests it. Global < domain < session < answer overrides. AutoRecord off stops future automatic writes immediately. Omit patch for read-only inspection; clearOverride removes this layer.',
  inputSchema:{scope:scopeSchema.default('global'),selector:z.string().max(200).default(''),turnKey:key.optional(),patch:configPatchSchema.optional(),clearOverride:z.boolean().default(false)},annotations,
},async({scope,selector,turnKey,patch,clearOverride})=>{
  if(scope==='session'&&!selector&&turnKey)selector=(await runtime.turn(turnKey)).sessionId;
  if(patch&&clearOverride)throw new Error('Choose patch or clearOverride, not both');
  if(clearOverride)runtime.config.clear(scope,selector);else if(patch)runtime.config.set(scope,selector,patch);
  return result({defaults:runtime.config.resolve(),overrides:runtime.config.list()});
});

server.registerTool('manage', {
  description:'User-requested local knowledge management. Inspect audit or saved source identifiers for one concept (sources + conceptId), undo the latest change, add an explicit domain alias, export/import a snapshot, or clear. Sources are retained deduplication receipts, not current counts or saved answer text. Do not mutate records without a user request. Clear requires confirmation="clear-local-profile".',
  inputSchema:{action:z.enum(['audit','sources','undo','alias','export','import','clear','clear-details']),auditId:z.number().int().positive().optional(),
    domain:z.string().optional(),alias:z.string().optional(),conceptId:id.optional(),snapshot:z.unknown().optional(),replace:z.boolean().default(false),confirmation:z.string().optional()},annotations:{...annotations,destructiveHint:true},
},async(input)=>{
  switch(input.action){
    case 'audit':return result(await runtime.store.auditLog('local'));
    case 'sources':return result(await runtime.store.sources('local',input.conceptId));
    case 'undo':await runtime.store.undo('local',input.auditId);break;
    case 'alias':await runtime.store.setAlias('local',input.domain,input.alias,input.conceptId);break;
    case 'export':return result(await runtime.store.exportProfile('local'));
    case 'import':await runtime.store.importProfile('local',input.snapshot,input.replace);break;
    case 'clear':if(input.confirmation!=='clear-local-profile')throw new Error('Explicit clear confirmation required');await runtime.clearProfile();break;
    case 'clear-details':await runtime.clearDetails();break;
  }
  return result({saved:true});
});

server.registerTool('detail', {
  description: 'Retrieve a named answer detail when the user asks to expand it. Returns only the trunk, ancestor content and this node; no unrelated sibling details. Retrieval alone does not count as displayed explanation.',
  inputSchema: { turnKey: key, nodeId: id }, annotations: { ...annotations, readOnlyHint: true },
}, async ({ turnKey, nodeId }) => result(await runtime.detail(turnKey, nodeId)));

server.registerTool('takeaway', {
  description: 'Save a concise conclusion from a detail exploration when the user wants it returned to the main discussion. Do not copy the whole branch.',
  inputSchema: { turnKey: key, nodeId: id, takeaway: z.string().min(1).max(2000) }, annotations,
}, async ({ turnKey, nodeId, takeaway }) => result(await runtime.saveTakeaway(turnKey, nodeId, takeaway)));

server.registerTool('panel', {
  description: 'Open the local ShuTong knowledge panel when the user asks to inspect, mark knowledge, or change the threshold.',
  inputSchema: { turnKey: key.optional() }, annotations,
}, async ({ turnKey }) => result({ panelUrl: await ensurePanel(runtime.directory, turnKey) }));

server.registerTool('status', {
  description: 'Inspect ShuTong activation and local recording state. Without a turn key lists local knowledge; use only when the user requests inspection.',
  inputSchema: { turnKey: key.optional() }, annotations: { ...annotations, readOnlyHint: true },
}, async ({ turnKey }) => result(await runtime.status(turnKey)));

await server.connect(new StdioServerTransport());
process.once('SIGTERM', () => { runtime.close(); process.exit(0); });
process.stdin.once('end', () => { runtime.close(); });
