import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'plugins/shutong/runtime');
await mkdir(output, { recursive: true });
await build({
  entryPoints: [resolve(root, 'runtime/main.mjs'), resolve(root, 'runtime/mcp-server.mjs')],
  outdir: output, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node',
  target: 'node22', format: 'esm', legalComments: 'eof',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
await writeFile(resolve(root, 'plugins/shutong/.mcp.json'), JSON.stringify({ mcpServers: { shutong: {
  command: process.execPath, args: [resolve(output, 'mcp-server.mjs')], env_vars: ['SHUTONG_DATA_DIR'],
} } }, null, 2));
console.log(`Built standalone plugin: ${resolve(root, 'plugins/shutong')}`);
