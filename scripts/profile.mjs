import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { SqliteKnowledgeStore } from '../packages/user-information/dist/index.js';

const help = `ShuTong 本地用户信息工具（尚未接入 Codex 对话）
用法：node scripts/profile.mjs [--db FILE] [--user ID] COMMAND [ARGS]

  status | list              查看当前用户阈值和知识点
  get ID...                  只查询指定知识点
  record                     从 stdin 读取已完成交付的事件 JSON
  known ID true|false        标记已掌握；false 清零并重新累计
  threshold N                设置正整数阈值，初始默认 1
  name ID NAME               修正显示名称
  count ID N                 手动修正次数，保留去重凭据
  export                     输出版本化 JSON，含去重凭据
  import [--replace]         从 stdin 恢复；替换已有档案需 --replace
  clear                      清空此用户的配置、知识点和去重凭据

默认用户为 local；SHUTONG_DATA_DIR 可指定数据目录。
此命令不会识别回答内容，也不会安装或修改 Codex 钩子。`;

function defaultDatabase() {
  if (process.env.SHUTONG_DATA_DIR) return resolve(process.env.SHUTONG_DATA_DIR, 'knowledge.sqlite');
  const base = process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'ShuTong')
    : process.platform === 'win32' ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'ShuTong')
    : join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'shutong');
  return join(base, 'knowledge.sqlite');
}

async function readJson() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) throw new Error('Input JSON exceeds 10 MiB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

let store;
try {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help')) {
    console.log(help);
  } else {
    let filename = defaultDatabase();
    let userId = 'local';
    while (args[0] === '--db' || args[0] === '--user') {
      const flag = args.shift();
      const value = args.shift();
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      if (flag === '--db') filename = resolve(value); else userId = value;
    }
    const command = args.shift();
    const arity = { status: 0, list: 0, known: 2, threshold: 1, name: 2, count: 2, export: 0, clear: 0, record: 0 };
    if (command === 'get') {
      if (args.length === 0) throw new Error('get requires at least one concept ID');
    } else if (command === 'import') {
      if (args.length > 1 || (args.length === 1 && args[0] !== '--replace')) throw new Error('Usage: import [--replace]');
    } else if (!Object.hasOwn(arity, command) || args.length !== arity[command]) {
      throw new Error('Unknown command or invalid arguments. Use --help.');
    }
    if (command === 'known' && !['true', 'false'].includes(args[1])) throw new Error('known requires true or false');
    if (command === 'threshold' || command === 'count') {
      const value = command === 'threshold' ? args[0] : args[1];
      if (!/^\d+$/.test(value)) throw new Error('Expected an integer');
    }
    const input = command === 'record' || command === 'import' ? await readJson() : undefined;
    if (command === 'record' && (input === null || typeof input !== 'object' || Array.isArray(input))) throw new Error('Expected an event object');
    if (command === 'record' && input.userId !== undefined && input.userId !== userId) throw new Error('Event userId differs from the selected user');
    await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
    store = new SqliteKnowledgeStore(filename);
    let result;
    switch (command) {
      case 'get': result = await store.read({ userId, conceptIds: args }); break;
      case 'record': await store.recordDelivered({ ...input, userId }); break;
      case 'known': await store.setKnown(userId, args[0], args[1] === 'true'); break;
      case 'threshold': await store.setThreshold(userId, Number(args[0])); break;
      case 'name': await store.setName(userId, args[0], args[1]); break;
      case 'count': await store.setExplanationCount(userId, args[0], Number(args[1])); break;
      case 'export': result = await store.exportProfile(userId); break;
      case 'import': await store.importProfile(userId, input, args[0] === '--replace'); break;
      case 'clear': await store.clearProfile(userId); break;
    }
    console.log(JSON.stringify(result ?? await store.list(userId), null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Profile operation failed');
  process.exitCode = 1;
} finally {
  store?.close();
}
