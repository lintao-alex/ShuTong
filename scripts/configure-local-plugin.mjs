// Run on the local source copy before installing: this Codex build does not expand
// ${PLUGIN_ROOT} inside MCP argv (hook commands do support it).
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] || 'plugins/shutong');
const manifest = JSON.parse(await readFile(resolve(root, '.codex-plugin/plugin.json'), 'utf8'));
if (manifest.name !== 'shutong') throw new Error('Not a ShuTong plugin');
const executable = await realpath(process.execPath);
const mcp = JSON.parse(await readFile(resolve(root, '.mcp.json'), 'utf8'));
mcp.mcpServers.shutong.command = executable;
mcp.mcpServers.shutong.args = [resolve(root, 'runtime/mcp-server.mjs')];
mcp.mcpServers.shutong.env_vars = ['SHUTONG_DATA_DIR'];
await writeFile(resolve(root, '.mcp.json'), JSON.stringify(mcp, null, 2));
const hooks = JSON.parse(await readFile(resolve(root, 'hooks/hooks.json'), 'utf8'));
for (const groups of Object.values(hooks.hooks)) for (const group of groups) for (const hook of group.hooks) {
  hook.command = `${JSON.stringify(executable)} "\${PLUGIN_ROOT}/runtime/main.mjs" hook`;
}
await writeFile(resolve(root, 'hooks/hooks.json'), JSON.stringify(hooks, null, 2));
console.log('Configured local Node and MCP paths.');
