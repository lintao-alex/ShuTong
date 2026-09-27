# ShuTong (书童)

English | [简体中文](README.zh-CN.md)

**AI answers that are easier to read: the main answer first, details when you need them.**

ShuTong is a local Codex plugin that combines optional answer details with a record of concepts already explained to you. Its goal is less reading effort, with no mandatory per-answer check-in.

**Status:** 0.1.0 source preview · **License:** [MIT](LICENSE) · **Verified host:** Codex on macOS. Other hosts are planned; Windows and Linux paths exist but have not had full end-to-end validation. The panel currently uses Chinese labels, explained below.

## What it does

- Presents a concise main answer and named details in a local browser panel. Simple answers stay simple.
- Counts delivered explanations across chats and projects for the same local OS user and Codex configuration. The default threshold is **1**, and you can change it.
- Asks the model to skip familiar basics. Explicit requests to explain again take precedence.
- Lets you optionally mark concepts known, search or edit records, inspect source identifiers, undo changes, export records, and clear data.
- Separates automatic recording from adaptive output, with global, domain, chat, and per-answer controls.
- Displays Markdown, tables, code blocks, and bounded Mermaid flowcharts and sequence diagrams.

Counts mean “shown before,” not mastery, confidence, or permanent understanding. Hidden detail explanations count only when displayed; merely generating or retrieving them does not count. Reopening the same detail does not add another count for that original answer.

## Install from source

You need **Node.js 22.22.2+**, **pnpm 10.33.2**, and Codex with plugin and hook support. The most recent local CLI verification used `0.158.0-alpha.2.1`; this is a tested version, not a claimed minimum.

For a fresh checkout, run the commands below. If you already downloaded or cloned [this repository](https://github.com/lintao-alex/ShuTong), skip the first two lines and run the remaining commands **from its root**. Keep the checkout in a stable location:

```sh
git clone https://github.com/lintao-alex/ShuTong.git
cd ShuTong
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
node scripts/configure-local-plugin.mjs ./plugins/shutong
codex plugin marketplace add .
codex plugin add shutong@shutong-preview
```

`pnpm check` compiles the project, builds the plugin, and runs tests. It does not call an LLM or require an API key; integration tests start temporary loopback HTTP servers. Your normal Codex account and usage limits apply when you later use the plugin in a conversation.

The build generates machine-specific paths. Keep the source directory: the current MCP configuration points to its runtime. If you move it, configure and reinstall again. Review any hook trust prompts in Codex, then **start a new chat**. ShuTong uses `UserPromptSubmit`, `Stop`, and `Interrupt` hooks.

If you already use `shutong@personal`, keep that development source instead of installing a second copy. The commands above use this repository's `shutong-preview` marketplace. See the [user guide](docs/user-guide.md) for updates, disabling, and removal.

## Try it

In a new Codex chat, ask a multi-part question:

> Design a minimal internal knowledge-base assistant for a 20-person team with 500 Markdown documents and different access permissions. Explain the recommendation, dependencies, risks, and implementation steps. Discuss the design only; do not browse or edit files.

Expect a compact answer with an **展开细节与知识点** (“Expand details and knowledge”) link when useful. The panel has **回答与细节** (answer and details), **知识点** (knowledge), and **设置** (settings) views. You do not need to open it on every turn.

You can also say:

- “Explain this fully; do not fold any part of the answer.”
- “Explain RAG again from the beginning.”
- “Disable automatic recording, but keep using my existing records.”
- “Open the ShuTong panel.”

A whole-answer request bypasses folding for that answer. Asking for one topic's implementation details can still use detail nodes. Neither request resets long-term counts.

## Data and privacy

ShuTong stores its profile and settings locally, without its own cloud sync or telemetry service. Normal hooks do not scan your full conversation history. Selected answer content and identifiers are temporarily retained.

**Local storage does not mean all information stays outside the model:** relevant concept records and instructions are returned to Codex through tools and become part of the host's model context. The host's own data handling still applies.

| Platform | Default data directory |
| --- | --- |
| macOS | `~/Library/Application Support/ShuTong/` |
| Windows | `%LOCALAPPDATA%\ShuTong\` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/shutong/` |

`SHUTONG_DATA_DIR` selects an isolated directory. Knowledge and settings persist until changed or removed. Temporary answer details expire after 24 hours; file cleanup happens on a subsequent new turn, not on a background timer. The panel can clear them sooner. Knowledge exports exclude settings, audit history, and temporary details.

The panel binds to `127.0.0.1` and uses an access token in its URL. Treat that URL and exported records as private. See [data controls and backups](docs/user-guide.md#data-controls-and-backups) and [security boundaries](SECURITY.md).

## Current limits

- Details use a separate local page, **not native folding inside a Codex message**.
- Concept identification, matching, and selection of important conditions depend on the model. Checks preserve declared conditions; they cannot guarantee that every important point was identified. Asking for a complete answer is not a completeness guarantee.
- Details are generated ahead of time. Less visible text does **not** imply fewer tokens or a smaller bill; tool calls can increase usage. No token-saving claim is made.
- Diagram support covers flowcharts and sequence diagrams with source fallback. Formulas, other diagram types, and code syntax highlighting are not implemented.
- Sources show saved host/chat/turn identifiers, not original conversation text or links back to those chats.
- There is no cross-device sync, learning recommendation system, or full branching chat client.

The latest code validation passed 100 tests. This is evidence of tested behavior, not proof of subjective reading improvement or general savings. The current priority is feedback from actual Codex use.

## Architecture and development

The **user information module** supplies records; the **output module** consumes relevant information to shape responses. The two support multiple information types and output capabilities rather than a single hard-wired summarizer.

| Directory | Purpose |
| --- | --- |
| `packages/` | Contracts, information providers, output policies, Codex adapter |
| `runtime/` | Hooks, MCP server, configuration, local panel |
| `plugins/shutong/` | Plugin manifest, hooks, Skill, generated runtime |
| `skills/progressive-collaboration/` | Standalone output policy without automatic tracking |
| `schemas/` | Versioned JSON formats |
| `tests/` | Regression tests and fixed evaluation cases |

```sh
pnpm check
pnpm demo
pnpm demo:profile
node scripts/report-cost.mjs examples/token-comparison.json /tmp/shutong-report.html
```

These commands do not call a model. The report uses supplied historical measurements; it is not a live savings meter. The separate `evaluate-codex.mjs` and `evaluate-memory.mjs` scripts **do** invoke models and consume usage. Read their instructions before running them.

See [CONTRIBUTING](CONTRIBUTING.md) for the development workflow and useful bug reports.

## Documentation

- [User guide: operation, data, updates, troubleshooting](docs/user-guide.md) — English
- [Documentation index / 文档索引](docs/README.md)
- [Detailed behavior](docs/progressive-output.md), [settings](docs/settings.md), [records](docs/local-profile.md) — 简体中文
- [Developer internals](docs/development.md), [token measurement](docs/token-measurement.md), [0.1.0 release notes](docs/release-0.1.0.md) — 简体中文
- [Changelog](CHANGELOG.md) · [Security](SECURITY.md) · [MIT license](LICENSE)

Use [Issues](https://github.com/lintao-alex/ShuTong/issues) for feedback and [Pull Requests](https://github.com/lintao-alex/ShuTong/pulls) for contributions. No hosted service or support SLA is provided. Dependencies retain their own licenses.
