# 安装方式与兼容边界

## 完整 Codex 插件（当前默认）

先在仓库执行 `pnpm install --frozen-lockfile --ignore-scripts`、`pnpm check`。生成的 `plugins/shutong/` 是插件来源，包含 Skill、MCP 和 UserPromptSubmit/Stop/Interrupt 钩子。按 Codex 的本地插件安装流程注册来源并安装；在来源目录执行 `node scripts/configure-local-plugin.mjs /absolute/plugin/path`，写入本机 Node 和 MCP 路径。

本机开发安装使用个人市场中的 `shutong@personal`，来源为 `~/plugins/shutong/`。开发更新须通过 cachebuster 和 `codex plugin add shutong@personal` 重新安装，不直接改缓存。新任务用于加载新版本；原来的三条钩子若提示未信任，在宿主钩子管理界面审核。

## 独立 Skill

`skills/progressive-collaboration/` 只包含平台中立输出规则。复制到支持 Skill 的宿主目录并按该宿主方式调用，可获得主干、可展开话题和媒介选择；不需要用户画像。未接 UI 时用话题列表和追问展开，不承诺原生折叠、计数或自动记录。

已做 Skill 格式校验；尚未在第二种宿主实测，不把格式兼容等同于运行兼容。

## 本地工具与存储

`pnpm build:plugin` 后可用 Node 运行 `plugins/shutong/runtime/mcp-server.mjs`，提供 context/stage/detail/config/manage 等工具；标准 stdio MCP 传输已通过集成测试。数据库维护也可直接运行 `scripts/profile.mjs`。

通用 MCP 本身不提供其他宿主的回答完成信号。要在非 Codex 宿主自动计数，需要相应适配器创建回合、确认交付并处理取消。当前只有 Codex 适配器通过真实模型验证；其他宿主可以先使用独立 Skill 或显式管理能力，不应声称开箱即用全自动。

## 开放格式

`schemas/` 保存知识快照、配置补丁、本轮覆盖和回答详情的 JSON Schema；通过 `pnpm schemas` 从运行时契约重新生成。数据库结构版本 2 会迁移原版本 1，知识导出仍为 `shutong-knowledge` 版本 1，新增可选别名字段。升级迁移已有次数和阈值已有回归测试。

许可证已确定为 MIT。仓库包含 shutong-preview 安装目录，下载后先本地构建再安装，详见 [0.1.0 发布说明](release-0.1.0.md)。远程地址和 GitHub 发布仍待维护者提供。第二宿主标为待实现，先完成 Codex 体验验证。
