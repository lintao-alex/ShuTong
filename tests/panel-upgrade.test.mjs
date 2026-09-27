import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicJson,readJson } from '../runtime/engine.mjs';
import { ensurePanel } from '../runtime/panel.mjs';

test('a running old panel is replaced during upgrade and a current panel is reused', {timeout:15000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'shutong-panel-upgrade-'));let stopped=false;
 const legacy=createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url.startsWith('/health'))res.end(JSON.stringify({service:'shutong'}));
  else if(req.url.startsWith('/shutdown')){stopped=true;res.end('{}');legacy.close();}
  else res.writeHead(404).end();
 });
 await new Promise(resolve=>legacy.listen(0,'127.0.0.1',resolve));
 const oldUrl=`http://127.0.0.1:${legacy.address().port}`;
 await atomicJson(join(directory,'panel.json'),{pid:-1,url:oldUrl,token:'legacy-test'});
 t.after(async()=>{
  legacy.close();
  const p=await readJson(join(directory,'panel.json'));
  if(p&&p.pid!==-1)await fetch(`${p.url}/shutdown?token=${p.token}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});
  await rm(directory,{recursive:true,force:true});
 });
 const current=await ensurePanel(directory);
 assert.ok(stopped);assert.notEqual(new URL(current).origin,oldUrl);
 assert.equal(await ensurePanel(directory),current);
 const page=await(await fetch(current)).text();
 assert.ok(page.includes('回答与细节'));assert.ok(page.includes('.markdown table'));
});
