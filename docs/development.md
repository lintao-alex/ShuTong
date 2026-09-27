# 开发说明

当前已接通本地信息存储、解释策略、Codex MCP/钩子与主干详情/知识点/设置三视图面板。真实模型与安装验证见 [Codex 验证指南](try-in-codex.md)。

## 环境与命令

需要 Node.js 22.22.2 或以上兼容版本、pnpm 10.33.2。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm demo
pnpm demo:profile
```

`check` 编译所有模块，检查正反类型契约，再执行运行时测试。`demo` 使用固定数据展示接口调用；`demo:profile` 使用临时 SQLite 数据库演示记录与恢复。两者均不读取真实用户信息或调用模型。

## 模块职责

| 目录 | 职责 |
| --- | --- |
| `packages/contracts` | 用户信息读取、输出能力、知识点记录和计数写入接口 |
| `packages/user-information` | 按信息类型注册提供者，处理不可用数据；实现 SQLite 存储及运行时校验 |
| `packages/output` | 运行输出能力，限制读取范围，实现知识点解释策略 |
| `packages/host-codex` | 解析 Codex Stop 输入，返回待确认的回答候选 |
| `tests` | 验证多对多组合、查询范围、事务、跨进程去重、CLI 及事件输入 |
| `runtime` | MCP 工具、钩子生命周期、本地面板 |
| `plugins/shutong` | 可安装的插件清单、Skill 与打包运行时 |

添加用户信息类型时扩展应用自己的类型映射并注册提供者。添加输出能力时实现 `OutputCapability` 并声明依赖。输出模块不导入用户信息的存储实现；提供者不可向读取方暴露写入入口。

目前注册表是进程内的受信代码组合工具，不用于隔离不可信插件。外部输入需在宿主或工具边界验证。

`SqliteKnowledgeStore` 可注册为 `knowledge` 提供者。默认阈值来自 `@shutong/contracts` 的 `DEFAULT_EXPLANATION_THRESHOLD = 1`；已保存阈值不会被默认值覆盖。维护命令和数据格式见 [本地用户信息](local-profile.md)。

## 可选的 Codex 协议探测

系统需能运行 `codex`；也可以使用 `SHUTONG_CODEX_BIN` 指定其可执行文件。

```sh
pnpm probe:codex
```

探测启动独立进程，以临时配置查询 Stop 钩子是否被识别。它不创建任务、不调用模型、不信任钩子，也不更改持久配置。Codex 自身可能访问运行时状态目录，受限执行环境可能禁止启动。

探测通过只证明当前本机的协议和配置发现可用，不证明真实回合的钩子执行、回答交付或知识点提取已通过。Stop 解析结果始终是 `delivery: unverified`，不能直接提交计数。

协议依据：[Codex hooks](https://learn.chatgpt.com/docs/hooks)。已验证本机 Codex CLI 0.155.0-alpha.16.4；其他宿主需要单独验收。

## 输出和配置协议

`runtime/presentation.mjs` 定义有预算的主干/详情结构及父路径检索；`runtime/config.mjs` 定义独立开关、覆盖优先级和媒介约束。`panel-view.mjs` 管理三视图；`engine.mjs` 确认交付、计数、临时详情生命周期。平台中立 Skill 位于 `skills/progressive-collaboration/`，构建时复制为插件参考策略。

`pnpm schemas` 更新 `schemas/` 中的开放 JSON Schema。固定场景位于 `tests/fixtures/golden-conversations.json`；它们是可执行策略回归，不是 16 次模型评测。真实模型、浏览器操作和收益对照的证据应单独记录。

## 单次运行成本摘要

使用相同模型、同一问题和新任务分别保存 CLI 的 JSONL 与最终回答，再运行：

```sh
node scripts/measure-run.mjs /path/to/events.jsonl /path/to/final-answer.txt
```

脚本只接受一个成功完成的回合；按 `item.completed` 计工具调用，避免把 started/completed 算成两次。结果包含正文字符、宿主报告的 Token、工具输入/返回字符、是否重复提交主干及详情量；不输出提示词、回答内容或面板访问凭据。Token 不与字符混算，cached 和 reasoning 的子项不再重复加总。跨回合或未完成日志应先分开。

新版 `runtime/wire.mjs` 只向模型返回决策所需字段，完整运行时状态仍可通过用户主动请求的管理工具查询。输出主干由 Stop 确认；省略 trunk 的旧协议仍支持，新客户端为了发送前检查会额外提交短主干。

## 主干稳定性套件

固定题目及人工核对清单位于 `tests/fixtures/model-evaluation.json`。以下命令会实际调用模型，使用两个问题各两次、并发最多 2；每次使用新任务和独立档案，不修改日常知识记录：

```sh
node scripts/evaluate-codex.mjs /absolute/temp/results baseline 2
# 安装要测试的新版后，换一个标签：
node scripts/evaluate-codex.mjs /absolute/temp/results reviewed 2 --reviewed
```

已有输出目录会拒绝重用，避免旧记录污染新样本。`--reviewed` 要求工具的主干检查通过、实际正文匹配且 stage 不超过两次；失败不会被仅有低 Token 掩盖。关键条件的语义检查仍须按 fixture 清单人工核对，机器检查不能代替它。

新协议的 `presentation.reviewTrunk=true` 会先检查短主干与声明条件覆盖；默认中日韩 420 个可读字符／英文 180 词，必要条件可扩展预算。最多修订一次，失败直接降级。`status.turn.lengthReview` 和成本摘要分别报告检查结果和实际交付匹配。旧的省略 trunk 协议保留兼容，不冒充已通过此检查。

## 跨任务记录对照

固定题目和人工评分标准位于 `tests/fixtures/memory-evaluation.json`。先在独立目录 `seed/profile` 中通过真实 CLI 解释并自动计数，保留 seed/events.jsonl 和 seed/answer.txt，再运行：

```sh
node scripts/evaluate-memory.mjs /absolute/temp/memory-suite run-a named 2
node scripts/evaluate-memory.mjs /absolute/temp/memory-suite run-b implicit 1
```

脚本将真实种子快照复制到有记录和关闭应用组，为空档案组创建空库；所有任务独立、不共享聊天。测量阶段关闭分层、自动写入和主动图表策略，三组仅在知识记录或应用开关上不同。命名题默认每组两次并附一次明确追问；不点名概念的题默认可用每组一次补充验证。已有目录与快照拒绝覆盖。

结果包含查询、候选、最终 stage ID、种子概念覆盖和档案未变验证。角色说明、幂等键复用、退避参数和失败边界属于必要应用说明，不能仅因用了概念名称就算重复基础定义。语义判定须引用实际句子，不能用答案短或工具运行成功替代收益证据。


条件覆盖：节点可传 `requiredInTrunk: string[]`，与全局 `criticalPoints` 合并、规范化去重。缺少声明句返回 `review.status=missing-critical-points` 和原文 `missingCriticalPoints`；覆盖与长度共用一次修订机会。为兼容旧客户端，状态仍放在 `status.turn.lengthReview`。Stop 及省略 trunk 的兼容路径也检查节点条件。字段可省略；不能把通过检查当作模型识别了所有风险的证明。`tests/condition-coverage.test.mjs` 与打包 MCP 集成覆盖失败、修订及回退。


面板富文本由 `runtime/markdown.mjs` 本地渲染。`/state` 只增加 `presentation.trunkHtml`，`/detail` 增加 `node.bodyHtml`；隐藏正文不在状态轮询中预载。客户端只能把这两个受控字段作为 HTML 插入，其余名称、标题、摘要仍使用 textContent。Markdown 禁止原始 HTML、执行链接和图片加载，CSP 限制脚本与连接来源；渲染策略变更要更新 rendererVersion，使已运行的旧面板被替换。原始正文仍用于证据核对，MCP 与持久化结构不变。


面板 `/edit-concept` 只编辑已有 local 记录，传 id/name/explanationCount 与 expected（原名称、次数、手动已知状态）。SqliteKnowledgeStore.editConcept 在同一写事务中比较快照、更新字段并写单条 manual-edit 审计；冲突返回 409，验证失败 400，未授权 403。沿用通用 undo，保留去重凭据；不增加 schema 版本。前端编辑时暂停列表重建，后台自动计数仍正常运行，最终由事务比较决定是否允许保存。


图示模块 `runtime/diagram.mjs` 负责类型/预算检查、隔离页和跨窗口消息。Markdown 只生成带原文的 figure；主页面将源码通过 postMessage 送入 opaque-origin sandbox，按 frame.contentWindow 与随机请求 ID 匹配结果。沙箱页面只有静态脚本，无令牌；数据接口仍须鉴权。严格模式、SVG 清理和 CSP 共同限制交互与外部资源。渲染库为 @mermaid-js/tiny 12.0.0，构建时复制脚本及其许可证。

打包面板版本由构建脚本对 UI/图示/Markdown 源码及 package.json 生成统一摘要，通过 define 写入 main 和 MCP 两个入口。不能直接以打包后的 function.toString() 作为两个入口共用的版本签名，变量改写会导致相同功能获得不同版本、反复重启面板。源码运行仍用本地签名。


来源查询：SqliteKnowledgeStore.sources(userId, conceptId) 在只读事务中返回 concept、totalReceipts、receipts（hostId/sessionId/requestId）、hasMore。按写入 rowid 逆序取 20 条，不能解释为事件时间；不返回 responseId 哈希或正文。新增 receipts_by_concept(user_id,concept_id) 索引，沿用 schema v2；启动时幂等创建，旧数据不回填。面板 GET /sources 必须通过 token 校验并固定 local 用户；MCP manage(action=sources,conceptId) 仅在用户要求检查时调用。日常 context 不额外查询或注入来源。
