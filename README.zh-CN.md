# ShuTong（书童）

[English](README.md) | 简体中文

ShuTong 的首要目标是让 AI 回答读起来不吃力：先看主干，需要时再展开细节。通过可扩展的用户信息与输出能力，尝试减少不必要的重复解释。

当前为 **0.1.0 源码预览版**，采用 **[MIT](LICENSE)**。主要在 macOS 的 Codex 验证；第二宿主待实现。Windows/Linux 已有数据路径支持，但未完成端到端验证。面板当前使用中文标签。

## 从源码安装

需要 Node.js **22.22.2+**、pnpm **10.33.2** 和支持插件及钩子的 Codex。最近本机验证版本为 CLI `0.158.0-alpha.2.1`，不代表最低兼容版本。新检出可执行下列命令；如果已经下载或克隆仓库，跳过前两行，**在仓库根目录**执行剩余命令：

```sh
git clone https://github.com/lintao-alex/ShuTong.git
cd ShuTong
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
node scripts/configure-local-plugin.mjs ./plugins/shutong
codex plugin marketplace add .
codex plugin add shutong@shutong-preview
```

`pnpm check` 会编译、构建插件并测试，不调用模型、不需要 API Key；集成测试需允许临时本地 HTTP 监听。日常对话仍使用你自己的 Codex 账号及额度。

按 Codex 提示审核 UserPromptSubmit、Stop、Interrupt 三条钩子，然后**新建对话**。保留源码目录，MCP 配置会引用其中的运行时；移动目录后需要重新配置并安装。已有 `shutong@personal` 开发版的用户继续使用原来源，不要再装第二份。

## 先试一次

> 为一个 20 人团队设计内部知识库问答的最小方案，已有 500 份 Markdown 文档且权限不同。请说明结论、步骤、方案关系、风险和实施细节。仅讨论，不查资料、不修改文件。

复杂回答通常先给简短主干，末尾提供“展开细节与知识点”链接；简单回答可以没有链接。也可直接说“打开 ShuTong 面板”“这次完整详细讲，不要折叠”“重新从头解释 RAG”或“停止自动记录，但保留已有记录的应用”。不需要每轮操作面板。

## 产品结构

- **用户信息模块**：记录和管理用户信息，首项能力为知识点解释次数与用户手动标记。
- **输出模块**：使用相关用户信息调整输出，包含减少重复基础解释、主干优先和按需详情，支持按内容选择表达媒介。

两侧支持多对多组合，为后续信息类型和输出能力保留扩展空间。

## 第一条实现路径

自动累计知识点解释次数，达到可配置阈值后默认省略基础解释，默认阈值为 1 次。用户也可以主动展开本次知识点列表并标记已知，获得同样的效果。用户再次提问时正常解释，现有机制检查已声明的关键条件，但不保证模型列出了全部知识。需要系统梳理时可要求“完整版、不要折叠”。

## 当前状态

已实现本地版本：SQLite 机械计数、去重与手动标记，主干与折叠详情，独立功能开关和分层覆盖，领域/别名检索及有限名称候选，变更审计与撤销，以及 Codex Skill/MCP/生命周期钩子。面板支持名称/次数修正、来源标识查看，正文支持 Markdown、表格、代码块、流程图和时序图。

详情通过本地独立页面展开，未提供 Codex 原生消息折叠。知识点识别和关键信息判断仍依赖模型；折叠可减少首层阅读量，不代表更少生成 Token。新版在发送前检查短主干，超长最多修订一次，并精简策略上下文；详情仍可即时展开。

- [文档索引](docs/README.md)
- [英文完整使用指南](docs/user-guide.md)
- [贡献说明](CONTRIBUTING.md) · [安全与隐私](SECURITY.md)（均含中文摘要）
- [0.1.0 下载后的构建与安装](docs/release-0.1.0.md)
- [Token 测量与离线对比](docs/token-measurement.md)
- [直接试用](docs/try-in-codex.md)
- [主干与详情行为](docs/progressive-output.md)
- [设置与覆盖](docs/settings.md)
- [安装方式、独立 Skill 和开放格式](docs/installation-options.md)
- [进度与验证边界](docs/status.md)

## 本地验证

需要 Node.js 22.22.2 或以上兼容版本、pnpm 10.33.2。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm demo
pnpm demo:profile
pnpm build:plugin
```

`demo` 验证组合接口；`demo:profile` 在临时数据库中验证默认阈值 1、重复计数保护及重新打开后的恢复，并自动清理演示数据。演示不调用模型、不记录真实用户信息。

模块职责和可选宿主探测见 [开发说明](docs/development.md)，查看与修改本地记录见 [本地用户信息使用说明](docs/local-profile.md)。

本目录是独立的产品 Git 仓库；公开仓库为 [lintao-alex/ShuTong](https://github.com/lintao-alex/ShuTong)。源码包不含个人数据、node_modules、生成运行时或本机路径配置。阅读体验交由用户反馈，不承诺节省 Token。


## 数据与隐私

数据默认位于 macOS 的 `~/Library/Application Support/ShuTong/`、Windows 的 `%LOCALAPPDATA%\ShuTong\`、Linux 的 `${XDG_DATA_HOME:-~/.local/share}/shutong/`。可通过传给运行时的 `SHUTONG_DATA_DIR` 隔离数据。相同系统用户和 Codex 配置跨项目/对话共享，不跨设备同步。

本地持久化不等于记录不会进入模型：相关知识点及规则会经 MCP 返回 Codex，受宿主的数据处理方式约束。ShuTong 没有独立云同步或遥测服务，也不主动扫描聊天全文；会暂存选择呈现的主干、详情及回合信息。数据没有由 ShuTong 额外加密。

知识与设置持久保存；临时详情 24 小时后不可访问，在后续新回合启动时清理，并非后台准点删除。可在面板提前清除。导出包含知识、阈值、别名和去重凭据，不含设置、审计或暂存详情。面板仅监听 `127.0.0.1`，链接令牌和导出文件不应公开。

## 升级、停用和卸载

更新到插件清单版本已变化的新发布版后，重复上面的构建、配置、安装步骤，再开启新对话。同版本开发重建需要通过 Codex 插件开发更新流程更换缓存标识，不直接编辑安装缓存。

暂时停用可关闭面板的“启用 ShuTong”。卸载仓库来源版本可执行：

```sh
codex plugin remove shutong@shutong-preview
codex plugin marketplace remove shutong-preview
```

按实际安装身份选择命令，不要删除其他插件共用的市场。卸载插件不会删除单独的数据目录，也不会让旧对话立即卸载已加载工具；需开启新对话或重启相关宿主。需要删除知识时可在卸载前使用面板清空，设置另行保留；完整移除数据前先停止宿主插件和面板，再自行删除选定数据目录。

## 限制与反馈

最新代码验证为 100 项测试通过，不表示模型必然识别全部概念、完整保留体系知识或节省 Token。详情提前生成；原生折叠、公式、其他图种、代码高亮、云同步、学习建议和完整聊天分支仍未实现。来源只显示标识，不能跳转原聊天。

阅读是否轻松由用户反馈。反馈请提供最小的脱敏示例、期望行为、系统/Node/pnpm/Codex 版本、插件身份和有效设置。已有对话不生效先新建对话；链接失效重新请求面板；迁移目录后重新配置路径。更多排查见 [Codex 验证指南](docs/try-in-codex.md) 和 [英文使用指南](docs/user-guide.md)。贡献请参考 [CONTRIBUTING](CONTRIBUTING.md)，漏洞报告参考 [SECURITY](SECURITY.md)。
