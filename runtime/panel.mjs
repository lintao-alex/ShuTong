import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { Runtime, atomicJson, readJson, dataDirectory } from './engine.mjs';
import { html, client } from './panel-view.mjs';
import { renderMarkdown, rendererVersion } from './markdown.mjs';
import {diagramHtml,diagramClient,diagramCsp,diagramLibrary,diagramVersion} from './diagram.mjs';

// Both packaged entrypoints must share one revision: bundled function.toString() is not stable.
const panelVersion = typeof SHUTONG_PANEL_REVISION==='string' ? SHUTONG_PANEL_REVISION
  : `2-${createHash('sha256').update(html + client + rendererVersion + diagramVersion + diagramClient).digest('hex').slice(0,16)}`;

export async function ensurePanel(directory, turn = '') {
  const descriptor = join(directory, 'panel.json');
  const existing = await readJson(descriptor);
  if (existing) {
    try {
      const response = await fetch(`${existing.url}/health?token=${existing.token}`, { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        const health = await response.json();
        if (health.service === 'shutong' && health.version === panelVersion) return `${existing.url}/?token=${existing.token}&turn=${turn}`;
        if (health.service === 'shutong') await fetch(`${existing.url}/shutdown?token=${existing.token}`, { method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(500) });
      }
    } catch { /* Restart an expired local panel. */ }
  }
  const child = spawn(process.execPath, [fileURLToPath(new URL('./main.mjs', import.meta.url)), 'serve'], {
    detached: true, stdio: 'ignore', env: { ...process.env, SHUTONG_DATA_DIR: directory },
  });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise(resolve => setTimeout(resolve, 75));
    if (spawnError) throw spawnError;
    const current = await readJson(descriptor);
    if (current?.pid === child.pid) return `${current.url}/?token=${current.token}&turn=${turn}`;
  }
  if (child.pid) child.kill();
  throw new Error('Local panel did not start');
}

export async function servePanel(directory = dataDirectory()) {
  const runtime = await Runtime.open(directory);
  const token = randomBytes(24).toString('hex');
  let idle;
  const server = createServer(async (req, res) => {
    clearTimeout(idle); idle = setTimeout(() => server.close(), 30 * 60 * 1000);
    const address = server.address();
    const host = `127.0.0.1:${address.port}`;
    if (req.headers.host !== host) { res.writeHead(403).end(); return; }
    const url = new URL(req.url, `http://${host}`);
    const send = (status, body, type = 'application/json', csp) => {
      res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': csp ?? "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; img-src 'none'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    // JS is static and contains no records/token; all data and mutating routes require the token.
    if (url.pathname === '/app.js' && req.method === 'GET') { send(200, client, 'text/javascript'); return; }
    if(req.method==='GET'&&['/diagram','/diagram.js','/mermaid.js'].includes(url.pathname)) {
      try {
        if(url.pathname==='/diagram')send(200,diagramHtml,'text/html',diagramCsp);
        else if(url.pathname==='/diagram.js')send(200,diagramClient,'text/javascript');
        else send(200,await diagramLibrary(),'text/javascript');
      }catch {send(503,{error:'Diagram renderer unavailable'});}
      return;
    }
    if (url.searchParams.get('token') !== token) { send(403, { error: 'Forbidden' }); return; }
    try {
      if (req.method === 'GET' && url.pathname === '/') send(200, html, 'text/html');
      else if (req.method === 'GET' && url.pathname === '/health') send(200, { service: 'shutong',version:panelVersion });
      else if (req.method === 'GET' && url.pathname === '/detail') {
        const detail = await runtime.detail(url.searchParams.get('turn'), url.searchParams.get('id'));
        send(200, {...detail, node:{...detail.node, bodyHtml:renderMarkdown(detail.node.body)}});
      }
      else if (req.method === 'GET' && url.pathname === '/state') {
        const state = await runtime.status(url.searchParams.get('turn'));
        if (state.presentation) state.presentation.trunkHtml = renderMarkdown(state.presentation.trunk);
        send(200, state);
      }
      else if (req.method === 'GET' && url.pathname === '/audit') send(200, await runtime.store.auditLog('local'));
      else if (req.method === 'GET' && url.pathname === '/sources') send(200, await runtime.store.sources('local',url.searchParams.get('id')));
      else if (req.method === 'GET' && url.pathname === '/export') send(200, await runtime.store.exportProfile('local'));
      else if (req.method === 'POST') {
        if (req.headers.origin && req.headers.origin !== `http://${host}`) { send(403, { error: 'Origin not allowed' }); return; }
        if (req.headers['content-type'] !== 'application/json') { send(415, { error: 'JSON required' }); return; }
        let body = ''; for await (const part of req) { body += part; if (body.length > (url.pathname === '/edit-concept' ? 20000 : 10000)) throw new Error('Too large'); }
        const input = JSON.parse(body);
        if (url.pathname === '/viewed') await runtime.viewedDetail(url.searchParams.get('turn'), input.id);
        else if (url.pathname === '/edit-concept') {
          try { await runtime.store.editConcept('local',input.id,input); }
          catch(error) {
            if(error.message==='Concept changed; reload before editing') { send(409,{error:'record-changed'}); return; }
            throw error;
          }
        }
        else if (url.pathname === '/known') await runtime.store.setKnown('local', input.id, input.known);
        else if (url.pathname === '/threshold') await runtime.store.setThreshold('local', input.value);
        else if (url.pathname === '/config') runtime.config.set('global','',input.patch);
        else if (url.pathname === '/undo') await runtime.store.undo('local',input.id);
        else if (url.pathname === '/clear') {if(input.confirmation!=='clear-local-profile')throw new Error('Confirm clear');await runtime.clearProfile();}
        else if (url.pathname === '/clear-details') await runtime.clearDetails();
        else if (url.pathname === '/shutdown') { send(200, { stopped: true }); server.close(); return; }
        else { send(404, { error: 'Not found' }); return; }
        send(200, { saved: true });
      } else send(404, { error: 'Not found' });
    } catch { send(400, { error: 'Invalid request or expired turn' }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const descriptor = { pid: process.pid, token, url: `http://127.0.0.1:${server.address().port}` };
  await atomicJson(join(directory, 'panel.json'), descriptor);
  idle = setTimeout(() => server.close(), 30 * 60 * 1000);
  server.on('close', async () => {
    clearTimeout(idle); runtime.close();
    if ((await readJson(join(directory, 'panel.json')))?.pid === process.pid) await rm(join(directory, 'panel.json'), { force: true });
  });
  process.once('SIGTERM', () => server.close());
  return { server, ...descriptor };
}
