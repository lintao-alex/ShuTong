# Security and privacy

[English README](README.md) · [中文 README](README.zh-CN.md)

The 0.1.0 source preview has automated and local integration coverage, but no independent security audit. No long-term support or response-time commitment is currently defined.

## Boundaries

- Local SQLite storage has no ShuTong-managed encryption, account system, cloud sync, or telemetry service.
- Relevant records and instructions are returned through MCP to the host's model; local persistence does not mean they never enter a provider's context.
- Hooks retain selected temporary state, not a full-history transcript archive. Explicit development evaluations can save complete test outputs.
- The panel is for loopback use, with token, Host, and Origin checks. Do not expose its port through a public proxy. A panel URL is an access credential.
- Markdown disables raw HTML and external image loading; diagrams use a restricted sandbox. This does not make all model output trustworthy or guarantee host security.
- The local OS account and in-process registry are trusted boundaries. Low-level `userId` is not a multi-user authorization system.

## Vulnerability reports

Do not post tokens, private records, credentials, or an exploit against someone else's installation in a public issue.

On [the project repository](https://github.com/lintao-alex/ShuTong/security), use **Security → Report a vulnerability** if private reporting is enabled. Until a private channel is published, ask the maintainer for one with a short, non-sensitive description. No private email address is currently advertised, and GitHub private reporting is not assumed to be enabled.

Include affected versions, a minimal synthetic reproduction, expected and observed behavior, and impact. Keep personal data out of reports.

## 中文摘要

源码预览版尚未经过独立安全审计。数据本地持久化，但相关记录可能通过工具进入宿主模型上下文；面板令牌属于访问凭据，不应公开，也不要把本地端口暴露到公网。敏感漏洞优先使用仓库启用的私密报告入口；尚无入口时，先以不含敏感细节的描述向维护者索取渠道，不虚构邮箱或响应承诺。
