import { build } from 'esbuild';
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import { resolve, dirname } from 'node:path';
import {createRequire} from 'node:module';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'plugins/shutong/runtime');
await mkdir(output, { recursive: true });
await copyFile(createRequire(import.meta.url).resolve('@mermaid-js/tiny'),resolve(output,'mermaid.tiny.js'));
await copyFile(resolve(dirname(createRequire(import.meta.url).resolve('@mermaid-js/tiny')),'../LICENSE'),resolve(output,'mermaid-LICENSE.txt'));
const references=resolve(root,'plugins/shutong/skills/shutong/references');
await mkdir(references,{recursive:true});
await copyFile(resolve(root,'skills/progressive-collaboration/SKILL.md'),resolve(references,'output-policy.md'));
const panelSources=await Promise.all(['runtime/panel-view.mjs','runtime/diagram.mjs','runtime/markdown.mjs','package.json'].map(path=>readFile(resolve(root,path))));
const panelRevision=`3-${createHash('sha256').update(Buffer.concat(panelSources)).digest('hex').slice(0,16)}`;
await build({
  entryPoints: [resolve(root, 'runtime/main.mjs'), resolve(root, 'runtime/mcp-server.mjs')],
  outdir: output, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node',
  target: 'node22', format: 'esm', legalComments: 'eof',
  define:{SHUTONG_PANEL_REVISION:JSON.stringify(panelRevision)},
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
await writeFile(resolve(root, 'plugins/shutong/.mcp.json'), JSON.stringify({ mcpServers: { shutong: {
  command: process.execPath, args: [resolve(output, 'mcp-server.mjs')], env_vars: ['SHUTONG_DATA_DIR'],
} } }, null, 2));
console.log(`Built standalone plugin: ${resolve(root, 'plugins/shutong')}`);
