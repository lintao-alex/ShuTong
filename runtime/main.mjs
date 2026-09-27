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
        if(!runtime.config.resolve({sessionId:event.session_id}).enabled){console.log('{}');runtime.close();runtime=null;process.exit(0);}
        const state = await runtime.start(event);
        console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext:
          `ShuTong active. SHUTONG_TURN=${state.key}. Before substantive answers call shutong context for relevant concepts (stable domain/IDs; explainIds for explicit questions) and obey its effective policy. Requests for implementation details can use detail nodes; set verbosity=detailed only for an explicit whole-answer full/inline/no-fold request. Before final output call stage. Keep bookkeeping quiet; if tools fail, answer normally.` } }));
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
