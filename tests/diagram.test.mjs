import test from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {diagramProblem,diagramClient,mountDiagrams} from '../runtime/diagram.mjs';
import {renderMarkdown} from '../runtime/markdown.mjs';
import {servePanel} from '../runtime/panel.mjs';

test('diagram policy permits bounded flows and sequences, rejects directives and unsupported types',()=>{
 for(const source of ['flowchart LR\nA-->B','%% comment\nsequenceDiagram\nA->>B: hello','graph TD\nA-->B'])assert.equal(diagramProblem(source),null);
 for(const source of ['pie\n"A":20','---\nconfig: {}\n---\nflowchart LR','flowchart LR\n%%{init: {securityLevel: "loose"}}%%','flowchart LR\nclick A "https://example.org"','flowchart LR\n'+'A'.repeat(6000),'flowchart LR\n'+'\n'.repeat(121),null])assert.ok(diagramProblem(source));
});
test('renderable figures preserve literal source while unsupported diagrams remain readable',()=>{
 const html=renderMarkdown('```mermaid\nflowchart LR\nA["<img src=x onerror=alert(1)>"]-->B\n```');
 assert.match(html,/<figure class="diagram">/);assert.match(html,/<details open>/);assert.match(html,/&lt;img/);
 assert.doesNotMatch(html,/<iframe|<img|onerror="/);
 const unsupported=renderMarkdown('```mermaid\npie\n"A":20\n```');
 assert.doesNotMatch(unsupported,/<figure/);assert.match(unsupported,/此图种暂未支持/);assert.match(unsupported,/<code/);
});
test('sandbox and parent bootstrap compile without interpolating diagram content into scripts',()=>{
 assert.doesNotThrow(()=>new Script(diagramClient));assert.doesNotThrow(()=>new Script(`(${mountDiagrams.toString()})`));
});
test('public diagram assets contain no records, sandbox stays opaque and data routes still require tokens',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'shutong-diagram-'));const p=await servePanel(dir);
 t.after(async()=>{await new Promise(resolve=>p.server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const shell=await fetch(`${p.url}/diagram`);assert.equal(shell.status,200);
 const policy=shell.headers.get('Content-Security-Policy');assert.match(policy,/sandbox allow-scripts/);assert.doesNotMatch(policy,/allow-same-origin/);assert.match(policy,/connect-src 'none'/);assert.match(policy,/img-src 'none'/);
 assert.doesNotMatch(await shell.text(),new RegExp(p.token));
 const library=await fetch(`${p.url}/mermaid.js`);assert.equal(library.status,200);assert.match(library.headers.get('Content-Type'),/javascript/);assert.ok((await library.text()).length>1000);
 assert.equal((await fetch(`${p.url}/state`)).status,403);assert.equal((await fetch(`${p.url}/export`)).status,403);
 assert.equal((await fetch(`${p.url}/diagram?token=${p.token}`)).status,200);
});
