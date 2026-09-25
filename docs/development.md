# 开发说明

当前已接通本地信息存储、解释策略、Codex MCP/钩子与独立知识点面板。真实模型与安装验证见 [Codex 验证指南](try-in-codex.md)。

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

协议依据：[Codex hooks](https://learn.chatgpt.com/docs/hooks)。实际宿主接入、UI 支持、安装流程和兼容版本需在后续集成阶段验证。
