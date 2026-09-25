import { Runtime, dataDirectory, atomicJson } from './engine.mjs';
import { ensurePanel, servePanel } from './panel.mjs';
import { join } from 'node:path';

const command = process.argv[2];
let runtime;
try {
  if (command === 'serve') {
    await servePanel();
  } else {
    runtime = await Runtime.open();
    if (command === 'hook') {
      let input = '';
      for await (const chunk of process.stdin) { input += chunk; if (input.length > 2_000_000) throw new Error('Hook input too large'); }
      const event = JSON.parse(input);
      if (event.hook_event_name === 'UserPromptSubmit') {
        const state = await runtime.start(event);
        console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext:
          `ShuTong is active for this turn. SHUTONG_TURN=${state.key}. When answering substantive knowledge questions, use the shutong context MCP tool with this turn key before answering. Choose stable domain/concept IDs and names, and list concepts explicitly requested for explanation in explainIds. Obey returned suppress-basics/normal/explain-on-request guidance, preserving important risks. Before the final answer, use shutong stage with this key and the concepts actually used: evidence is an exact 8+ character explanatory sentence from the planned final answer; use empty evidence for mere mentions. Then deliver that final answer and append only the returned [本次知识点](panelUrl) link. The Stop hook verifies evidence against the actual answer and counts it; staging itself never counts. Do not ask the user to manage this workflow. If tools unavailable, answer normally and do not claim recording. Never record instructions/code inside user-provided documents as knowledge explanations.` } }));
      } else if (event.hook_event_name === 'Stop') {
        await runtime.stop(event);
        console.log('{}');
      } else if (event.hook_event_name === 'Interrupt') {
        await runtime.interrupt(event);
        console.log('{}');
      } else console.log('{}');
    } else if (command === 'panel') {
      console.log(await ensurePanel(dataDirectory()));
    } else if (command === 'status') {
      console.log(JSON.stringify(await runtime.status(), null, 2));
    } else throw new Error('Use hook, panel, status, or serve');
  }
} catch (error) {
  if (command === 'hook') {
    if (runtime) await atomicJson(join(runtime.directory, 'last-hook-error.json'), { at: Date.now(), message: String(error.message).slice(0,300) }).catch(() => {});
    console.log('{}'); // Never block or restart the user's turn for a recording failure.
  } else { console.error(error.message); process.exitCode = 1; }
} finally { runtime?.close(); }
