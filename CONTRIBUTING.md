# Contributing

[English README](README.md) · [中文 README](README.zh-CN.md)

Small fixes, clearer documentation, and reproducible feedback on reading comfort are welcome. Discuss new hosts, cloud sync, or new information types before large implementations; these are deferred while the Codex experience is evaluated.

## Development

Use Node.js 22.22.2+ and pnpm 10.33.2. From the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
```

The suite uses temporary data directories and does not invoke an LLM. For manual experiments, pass `SHUTONG_DATA_DIR` pointing to disposable data to the processes you launch. Do not use your everyday profile. `pnpm demo` and `pnpm demo:profile` are also offline.

Edit source modules, not generated runtime or installed cache files. `pnpm check` rebuilds the plugin. Generated runtime, `.mcp.json`, databases, and `node_modules` are ignored. Run `pnpm schemas` and review the diff after changing a runtime schema.

## Pull requests and issues

- Explain the problem, resulting behavior, and verification. Keep unrelated changes separate.
- Preserve default threshold 1, mechanical counting, explicit re-explanation, deduplication, user controls, and isolation.
- Add focused regression coverage for behavior changes. Documentation edits need link and command checks, not a new test suite.
- Keep both READMEs consistent for setup, scope, and limitations. Label language-specific guides in the documentation index.
- Do not commit exports, panel URLs with tokens, chat logs, generated local paths, or credentials.
- Model benchmarks consume usage: scope them explicitly and report failures and overhead. Unit tests do not prove savings or semantic completeness.

Use [GitHub Issues](https://github.com/lintao-alex/ShuTong/issues) for reproducible feedback and [Pull Requests](https://github.com/lintao-alex/ShuTong/pulls) for contributions. Sensitive vulnerabilities follow [SECURITY.md](SECURITY.md).

Contributions are submitted under [MIT](LICENSE). Preserve dependency notices and the provenance of copied examples.

## 中文贡献摘要

欢迎修复、文档和阅读体验反馈。行为改动说明问题、结果及针对性验证；文档改动检查链接和命令。保留默认 1 次、机械计数、重讲、去重、控制开关和数据隔离。不要上传个人导出、带令牌链接或聊天日志。模型测试先明确范围；第二宿主、云同步等大扩展先讨论。中英文 README 的安装、能力与限制应同步。
