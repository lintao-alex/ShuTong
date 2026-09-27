# ShuTong 0.1.0 源码预览版

让 AI 回答先呈现容易阅读的主干，细节需要时再展开，并机械记住哪些知识点已经解释过。

## 下载后运行

这是源码包，不是预装好的插件缓存。需要 Node.js 22.22.2+、pnpm 10.33.2，以及支持插件的 Codex。下载源码后，在解压目录执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
node scripts/configure-local-plugin.mjs ./plugins/shutong
codex plugin marketplace add .
codex plugin add shutong@shutong-preview
```

构建会生成运行时和本机路径配置；保留该源码目录，移动后需重新配置和安装。首次使用按 Codex 提示审核钩子，然后开启新对话。当前 macOS/Codex 已验证；第二宿主待实现，其他操作系统尚未完整实测。

已有 `shutong@personal` 开发安装的用户继续使用原来源，不同时安装另一份。此版仓库市场用于新用户从源码安装；不要直接将本机缓存、绝对路径配置或个人知识库上传到 GitHub。

## 本版范围

自动计数默认 1；可选手动标记；主干/详情；记录与输出独立开关；管理、撤销和来源标识；Markdown/图示；MCP、独立 Skill 及开放格式。详见 [变更记录](../CHANGELOG.md) 和 [试用指南](try-in-codex.md)。

阅读是否轻松由用户判断。需要系统梳理时可明确说“给我完整版、不要折叠”；模型本身仍可能遗漏，不把这一请求当作完整性保证。现有关键条件检查保留，首版不继续扩大语义审稿机制。

本工具不承诺节省 Token。详情提前生成，工具交互可能增加消耗；历史样本和离线报告方法见 [Token 测量](token-measurement.md)。

## 发布状态

采用 [MIT](../LICENSE)。源码发布材料和本地提交已准备；GitHub 远程仓库、推送与 Release 页面需要维护者提供目标仓库并完成本机登录。此文件不能被解释为已经在 GitHub 上发布。

开源许可只适用于本项目自有代码；依赖保持各自许可证。源码包不包含 node_modules，依赖由锁文件安装，Mermaid 构建产物随其许可证复制。
