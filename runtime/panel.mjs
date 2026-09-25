import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { Runtime, atomicJson, readJson, dataDirectory } from './engine.mjs';

export async function ensurePanel(directory, turn = '') {
  const descriptor = join(directory, 'panel.json');
  const existing = await readJson(descriptor);
  if (existing) {
    try {
      const response = await fetch(`${existing.url}/health?token=${existing.token}`, { signal: AbortSignal.timeout(500) });
      if (response.ok && (await response.json()).service === 'shutong') return `${existing.url}/?token=${existing.token}&turn=${turn}`;
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

const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ShuTong · 本次知识点</title><style>
body{font:16px/1.65 system-ui,sans-serif;background:#f6f7f9;color:#17212b;margin:0;padding:36px 20px}main{max-width:760px;margin:auto}h1{font-size:28px;margin-bottom:4px}p{color:#596673}section{background:white;border:1px solid #dde3e8;border-radius:12px;padding:22px;margin:18px 0}label.row{display:flex;gap:12px;align-items:center;padding:14px 0;border-bottom:1px solid #edf0f3}input[type=checkbox]{width:20px;height:20px}small{display:block;color:#596673}button{border:1px solid #becbd4;background:white;border-radius:6px;padding:8px 14px;cursor:pointer;color:#17212b}input[type=number]{width:68px;padding:7px;font-size:16px}#notice{color:#a33525;min-height:24px}.badge{font-size:13px;color:#29644c}a{color:#23614f}.count{margin-left:auto;color:#596673;white-space:nowrap}button:disabled{opacity:.5}summary{cursor:pointer;font-weight:600}
</style><main><h1>ShuTong</h1><p>少读重复解释，保留你需要的新信息。</p><span id="phase" class="badge">正在读取本地记录…</span>
<section><h2 id="heading">本次知识点</h2><p>勾选后默认省略基础解释。取消勾选会重新累计；需要解释时直接追问即可。</p><div id="concepts"></div><p id="empty" hidden>本轮没有可显示的知识点。</p><button id="all">查看全部知识点</button></section>
<section><details><summary>详细设置</summary><p><label>默认解释次数 <input id="threshold" type="number" min="1" step="1" value="1"></label> <button id="save">保存</button></p><p>达到次数后默认省略基础解释。首次默认 1 次。</p><small>数据保存在本机。自动记录仅核对本轮提交的解释片段，未匹配的片段不会计数。</small></details></section>
<div id="notice" role="status"></div><script src="/app.js"></script></main></html>`;

const client = `const params=new URLSearchParams(location.search);const token=params.get('token');let turn=params.get('turn')||'';let busy=false;
if(!turn)document.getElementById('heading').textContent='全部知识点';
const api=async(path,body)=>{const url=path+'?token='+encodeURIComponent(token)+(turn?'&turn='+encodeURIComponent(turn):'');const r=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error('操作未保存，请刷新后重试');return r.json()};
const notice=document.getElementById('notice');
async function load(){if(busy)return;try{const data=await api('/state');if(document.activeElement!==document.getElementById('threshold'))document.getElementById('threshold').value=data.threshold;const phases={ready:'等待回答',staged:'等待回答完成后核对',recorded:'已核对本轮回答',interrupted:'本轮已取消', 'not-staged':'本轮未提交知识点，未计数'};document.getElementById('phase').textContent=data.turn?(phases[data.turn.phase]||data.turn.phase)+(data.turn.missingEvidenceCount?' · 有解释片段未匹配，已跳过':''):'全部本地记录';const list=document.getElementById('concepts');list.replaceChildren();document.getElementById('empty').hidden=data.concepts.length>0;
for(const c of data.concepts){const label=document.createElement('label');label.className='row';const box=document.createElement('input');box.type='checkbox';box.checked=c.manuallyKnown||c.explanationCount>=data.threshold;const title=document.createElement('span');title.textContent=c.name;const count=document.createElement('span');count.className='count';count.textContent='已解释 '+c.explanationCount+' 次';label.append(box,title,count);list.append(label);box.onchange=async()=>{busy=true;box.disabled=true;try{await api('/known',{id:c.conceptId,known:box.checked});notice.textContent='已保存';}catch(e){box.checked=!box.checked;notice.textContent=e.message;}finally{busy=false;await load()}}}}
catch(e){notice.textContent='暂时无法读取本地面板，请在 Codex 中重新打开 ShuTong 面板。'}}
document.getElementById('all').onclick=()=>{turn='';document.getElementById('heading').textContent='全部知识点';load()};document.getElementById('save').onclick=async()=>{const value=Number(document.getElementById('threshold').value);if(!Number.isSafeInteger(value)||value<1){notice.textContent='次数必须是大于 0 的整数';return;}busy=true;try{await api('/threshold',{value});notice.textContent='已保存';}catch(e){notice.textContent=e.message;}finally{busy=false;await load()}};load();setInterval(load,2500);`;

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
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'" });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    // JS is static and contains no records/token; all data and mutating routes require the token.
    if (url.pathname === '/app.js' && req.method === 'GET') { send(200, client, 'text/javascript'); return; }
    if (url.searchParams.get('token') !== token) { send(403, { error: 'Forbidden' }); return; }
    try {
      if (req.method === 'GET' && url.pathname === '/') send(200, html, 'text/html');
      else if (req.method === 'GET' && url.pathname === '/health') send(200, { service: 'shutong' });
      else if (req.method === 'GET' && url.pathname === '/state') send(200, await runtime.status(url.searchParams.get('turn')));
      else if (req.method === 'POST') {
        if (req.headers.origin && req.headers.origin !== `http://${host}`) { send(403, { error: 'Origin not allowed' }); return; }
        if (req.headers['content-type'] !== 'application/json') { send(415, { error: 'JSON required' }); return; }
        let body = ''; for await (const part of req) { body += part; if (body.length > 10000) throw new Error('Too large'); }
        const input = JSON.parse(body);
        if (url.pathname === '/known') await runtime.store.setKnown('local', input.id, input.known);
        else if (url.pathname === '/threshold') await runtime.store.setThreshold('local', input.value);
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
