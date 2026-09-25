// Read-only protocol probe: never starts a thread, trusts hooks, or calls a model.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const binary = process.env.SHUTONG_CODEX_BIN || 'codex';
const installed = process.argv.includes('--installed');
const directory = await mkdtemp(join(tmpdir(), 'shutong-host-probe-'));
let child;
try {
  const version = execFileSync(binary, ['--version'], {
    encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const argumentsList = ['app-server', '--stdio'];
  if (!installed) argumentsList.push('-c', 'hooks.Stop=[{hooks=[{type="command",command="node --version",timeout=1}]}]');
  child = spawn(binary, argumentsList, { cwd: directory, stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = createInterface({ input: child.stdout });
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Protocol probe timed out')), 20000);
    const finish = (error, value) => {
      clearTimeout(timeout);
      if (error) reject(error); else resolve(value);
    };
    child.once('error', error => finish(error));
    child.stdin.once('error', error => finish(error));
    child.once('exit', code => finish(new Error(`Protocol process exited: ${code}`)));
    const send = value => child.stdin.write(`${JSON.stringify(value)}\n`);
    lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id !== 1 && message.id !== 2) return;
      if (message.error) {
        finish(new Error(`RPC ${message.id} failed (code ${message.error.code})`));
        return;
      }
      if (message.id === 1) {
        send({ method: 'initialized' });
        send({ id: 2, method: 'hooks/list', params: { cwds: [directory] } });
      } else {
        const entries = message.result?.data;
        if (!Array.isArray(entries)) return finish(new Error('Unexpected hooks/list response'));
        const hooks = entries.flatMap(entry => entry.hooks ?? []).filter(hook => installed
          ? hook.pluginId === 'shutong@personal'
          : hook.eventName === 'stop' && hook.handlerType === 'command' && hook.command === 'node --version');
        if (hooks.length === 0) return finish(new Error('Expected hooks not discovered'));
        if (installed && (hooks.length !== 3 || hooks.some(hook => !hook.enabled || hook.trustStatus !== 'trusted'))) {
          return finish(new Error('ShuTong hooks are missing, disabled, or need trust review'));
        }
        finish(null, {
          version,
          initialization: 'passed',
          hooksList: 'passed',
          stopHookDiscovered: true,
          trustStatuses: [...new Set(hooks.map(hook => hook.trustStatus))],
          installedPlugin: installed ? 'shutong@personal' : null,
          hookEvents: hooks.map(hook => hook.eventName),
          hooksExecuted: false,
          modelCalled: false,
          liveAnswerRecordingVerified: false,
        });
      }
    });
    send({ id: 1, method: 'initialize', params: {
      clientInfo: { name: 'shutong_capability_probe', version: '0.0.1' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    } });
  });
  console.log(JSON.stringify(result, null, 2));
  lines.close();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Protocol probe failed');
  process.exitCode = 1;
} finally {
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 2000);
    await exited;
    clearTimeout(force);
  }
  await rm(directory, { recursive: true, force: true });
}
