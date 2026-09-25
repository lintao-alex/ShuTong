# 本地用户信息使用说明

本模块保存知识点解释次数、手动标记和阈值。默认阈值为 1，已有自定义阈值继续生效。它接收已经识别好的知识点记录，本身不识别对话；自动接入见 [Codex 验证指南](try-in-codex.md)。

## 先运行存储演示

在产品仓库执行：

```sh
pnpm build
pnpm demo:profile
```

预期结果：`defaultThreshold`、`afterFirstExplanation`、`afterRetry`、`afterReopen` 均为 `1`，`storageChecksPassed` 为 `true`。演示使用临时数据库并在退出时删除，不修改日常档案。

## 查看与维护记录

以下命令使用仓库内被 Git 忽略的演示数据目录。可将 `--db` 换成需要管理的数据库路径。

```sh
node scripts/profile.mjs --db ./local-data/demo.sqlite status
node scripts/profile.mjs --db ./local-data/demo.sqlite known hash-table true
node scripts/profile.mjs --db ./local-data/demo.sqlite name hash-table 哈希表
node scripts/profile.mjs --db ./local-data/demo.sqlite get hash-table
node scripts/profile.mjs --db ./local-data/demo.sqlite threshold 3
```

最后一条示范自定义阈值；不执行它则继续使用默认 1。手动标记不会人为增加解释次数。

`known hash-table false` 会取消标记并清零当前次数，保留旧事件的去重凭据；之后只有新请求的解释会再累计。此行为沿用阶段 1 的建议默认。

`count hash-table 2` 可主动修正当前次数，`name` 只更改显示名称，不合并概念。以上维护操作均为可选，不是用户日常必须执行的步骤。

## 模拟一条已完成的解释

```sh
node scripts/profile.mjs --db ./local-data/demo.sqlite record <<'JSON'
{
  "hostId": "manual-demo",
  "sessionId": "session-1",
  "requestId": "request-1",
  "responseId": "response-1",
  "explainedConceptIds": ["hash-table"],
  "mentionedConceptIds": ["hash-table", "hash-conflicts"]
}
JSON
```

哈希表增加一次，仅提及的哈希冲突保持 0。重复执行同一事件不会再增加；同一请求重新生成即使改变 `responseId` 也不会重复计数。只有新的逻辑请求应使用新的 `requestId`。

该命令用于开发和维护，不是模型已经解释过的证据。真实接入必须先确定回答完成并提取实际知识点，不能把 Stop 候选直接提交到此接口。

## 导入导出与清空

```sh
node scripts/profile.mjs --db ./local-data/demo.sqlite export > ./local-data/backup.json
node scripts/profile.mjs --db ./local-data/restored.sqlite import < ./local-data/backup.json
```

JSON 格式为 `shutong-knowledge`，版本为 `1`，包含阈值、知识点和已计数事件的去重凭据，不包含回答原文。导入验证整个快照后再开始事务；已有档案需要显式使用 `import --replace`，否则拒绝覆盖。

`clear` 清空选定用户的配置、知识点和去重凭据，下次使用恢复默认阈值 1。完整清空后旧事件若再次提交也会被视为新记录；这是清空所有数据的含义，与单项取消标记保留去重记录不同。

导出文件含个人知识点和会话标识，应放在自己的数据目录。示例使用的 `local-data/` 和 SQLite 数据库文件已被产品 `.gitignore` 排除。

## 数据路径和用户范围

- 默认用户标识为 `local`；可用 `--user ID` 管理其他独立档案，参数放在命令前。
- 默认数据目录在 macOS 为 `~/Library/Application Support/ShuTong/`，Windows 为本地应用数据目录中的 `ShuTong/`，Linux 为 `${XDG_DATA_HOME:-~/.local/share}/shutong/`。
- `SHUTONG_DATA_DIR` 可替换默认目录，`--db` 优先级最高。路径不随当前项目切换。
- 所有测试与演示均指定临时路径，不写入默认个人数据目录。

底层接口的 `userId` 供受信本地调用者使用，不是授权机制；以后 MCP/宿主适配器必须绑定用户身份，不能允许模型任意选择其他档案。

## 当前限制

使用 Node 的内置 `node:sqlite`；本机 Node 22 会输出实验性模块提示。此文说明底层存储与命令行；自动对话接入和面板已另行实现，具体支持范围以 Codex 验证指南为准。
