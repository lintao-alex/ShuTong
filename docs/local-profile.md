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

JSON 格式为 `shutong-knowledge`，版本为 `1`，包含阈值、知识点、可选领域别名和已计数事件的去重凭据，不包含回答原文、功能开关或审计历史。导入验证整个快照后再开始事务；已有档案需要显式使用 `import --replace`，否则拒绝覆盖。

`clear` 清空选定用户的知识档案（含阈值、知识点、别名、审计及去重凭据），不清除 settings.sqlite 功能设置，下次使用恢复默认阈值 1。完整清空后旧事件若再次提交也会被视为新记录；这是清空所有数据的含义，与单项取消标记保留去重记录不同。

导出文件含个人知识点和会话标识，应放在自己的数据目录。示例使用的 `local-data/` 和 SQLite 数据库文件已被产品 `.gitignore` 排除。

## 数据路径和用户范围

- 默认用户标识为 `local`；可用 `--user ID` 管理其他独立档案，参数放在命令前。
- 默认数据目录在 macOS 为 `~/Library/Application Support/ShuTong/`，Windows 为本地应用数据目录中的 `ShuTong/`，Linux 为 `${XDG_DATA_HOME:-~/.local/share}/shutong/`。
- `SHUTONG_DATA_DIR` 可替换默认目录，`--db` 优先级最高。路径不随当前项目切换。
- 所有测试与演示均指定临时路径，不写入默认个人数据目录。

底层接口的 `userId` 供受信本地调用者使用，不是授权机制；以后 MCP/宿主适配器必须绑定用户身份，不能允许模型任意选择其他档案。

## 当前限制

使用 Node 的内置 `node:sqlite`；本机 Node 22 会输出实验性模块提示。此文说明底层存储与命令行；自动对话接入和面板已另行实现，具体支持范围以 Codex 验证指南为准。

## 新增管理能力

面板提供知识点勾选、导出、清空以及最近 100 条变更的审计与撤销。撤销只允许当前记录的最新有效变更，并核对当前值，避免覆盖后续修改；旧请求的去重凭据保持不变。也可在知识点面板查找名称或 ID，点开某条记录的“调整”，修改显示名称和解释次数。

MCP `manage` 提供审计、撤销、显式领域别名、导入导出与清除暂存详情。别名由用户明确指定；同名多义词不会自动跨领域归并。概念和子概念分别计数，不做“懂父概念等于懂所有子概念”的推断。

面板清空知识记录会同时清除回合详情；底层 CLI 的 `clear` 只操作该数据库中的知识档案，不清除单独的功能设置或回合文件。详情的保留时间和清理规则见 [主干与按需详情](progressive-output.md)。

## 跨任务名称候选

模型在不同任务中可能给同一概念换 ID 或领域名。精确 ID／领域内名称没有命中时，运行时会返回与当前名称存在字面包含关系的少量旧记录：每个概念最多 3 个，每轮总计最多 12 个。少于两个字符的名称不走这种候选检索，避免过宽匹配。

候选不是自动匹配：原查询仍保持普通解释模式。只有模型确认候选确实表示本次同一概念时，才使用候选的规范 ID、名称和策略；该候选已由 context 返回，无须额外查询。歧义或不同领域同名词继续分别处理。不会自动建立别名、合并记录或推断用户真正掌握程度。

应用画像关闭时不读取候选；明确追问、抑制解释开关和自定义阈值也作用于候选。检索本身不增加次数。匹配依赖字面名称和模型判断，不能保证所有同义词都命中或所有选择都正确；底层数据库格式不变。


## 面板查找和调整

“查找”按名称或知识点 ID 过滤当前列表，忽略大小写并统一全角/半角字符；需要跨任务查找时先选择“查看全部”。每条记录的“调整”默认收起，日常自动计数不要求打开。

名称与解释次数一起保存、一起撤销；次数允许 0，不改变手动已知标记、阈值或去重凭据。修改名称不改变 ID、不合并概念，也不创建别名；显示名仍属于可由后续识别更新的记录信息。若希望重新累计并取消已知标记，沿用取消勾选的操作。

编辑期间定时刷新不覆盖输入；暂时禁用查找、切换全部和勾选，保存或取消后恢复。若记录已被其他回答或窗口更新，保存会拒绝覆盖，保留草稿并提供“载入最新记录”。该按钮会替换输入框中的草稿，之后可以重新调整。记录被删除时不能通过旧表单重新创建。

在“最近记录与修正”中点击刷新，可看到名称、次数的修改前后值。一次撤销恢复这次保存前的完整记录；有后续变更时，须先处理后续变更。无实际变化的保存不新增审计记录。


## 查看记录来源

每条知识点的“记录来源”默认收起，打开后只读取这条记录保存的宿主、对话和回合标识；不会读取宿主聊天历史或恢复解释原文。当前最多显示最后写入的 20 条，其余可在知识导出中查看。来源没有保存发生时间，导入还会改变写入顺序，因此列表不是对话时间线，也没有原聊天跳转功能。

当前解释次数与来源条数可能不同：手动修正、取消标记或撤销会改变次数，但保留来源用于防止旧请求重复计数。没有来源也不表示记录错误：仅提及、手动创建或不含凭据的导入都可能产生这种记录。查看本身不计数。

需要在对话中核对时，可要求 ShuTong 查看某个知识点的记录来源；管理工具使用 sources 和 conceptId。该读取只返回来源标识，不返回整份知识库或已删除的解释片段。


本地保存不排除模型访问：相关概念及规则会作为工具结果交给宿主模型处理。完整数据与安全边界见 [SECURITY](../SECURITY.md)；面板标识说明及备份限制另见 [English user guide](user-guide.md)。
