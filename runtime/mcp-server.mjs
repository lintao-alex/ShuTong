import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Runtime } from './engine.mjs';
import { ensurePanel } from './panel.mjs';

const runtime = await Runtime.open();
const server = new McpServer({ name: 'shutong', version: '0.1.0' });
const id = z.string().min(1).max(160);
const key = z.string().regex(/^[a-f0-9]{64}$/);
const concept = z.object({ id, name: z.string().min(1).max(160) });
const annotations = { destructiveHint: false, openWorldHint: false, idempotentHint: true };
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

server.registerTool('context', {
  description: 'Read ShuTong knowledge for this turn before composing a substantive answer. Use the SHUTONG_TURN key injected by the hook; preserve returned canonical IDs. Does not increment counts.',
  inputSchema: { turnKey: key, concepts: z.array(concept).max(20), explainIds: z.array(id).max(20).default([]) }, annotations,
}, async ({ turnKey, concepts, explainIds }) => result(await runtime.context(turnKey, concepts, explainIds)));

server.registerTool('stage', {
  description: 'Prepare knowledge metadata before delivering the final answer. evidence must be an exact explanatory sentence of 8+ characters from the final answer, or empty for a mere mention. This does NOT increment counts; Stop verifies the actual answer. Append the returned panelUrl as 本次知识点.',
  inputSchema: { turnKey: key, concepts: z.array(concept.extend({ evidence: z.string().max(1000) })).max(20) }, annotations,
}, async ({ turnKey, concepts }) => {
  const prepared = await runtime.stage(turnKey, concepts);
  let panelUrl = null;
  try { panelUrl = await ensurePanel(runtime.directory, turnKey); } catch { /* Recording must work without UI. */ }
  return result({ ...prepared, panelUrl });
});

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
