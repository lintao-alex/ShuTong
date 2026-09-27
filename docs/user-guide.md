# ShuTong user guide

[English README](../README.md) · [中文 README](../README.zh-CN.md) · [Documentation index](README.md)

This guide describes the 0.1.0 source preview after the README's source installation. Panel labels are currently Chinese; they do not restrict the language of your conversation.

## Everyday use

Ask your normal questions. Multi-part answers can have a short main answer and optional topics. Open **展开细节与知识点** when you want more. Simple replies may not need a panel link.

The default explanation threshold is **1**. Reaching it asks the model to omit repeated basic definitions; it does not mean you have mastered the topic. Explicit re-explanation takes priority without resetting the count.

Records are shared across chats and projects for the same local OS user and Codex configuration, including the CLI using that configuration. They do not synchronize between computers. `SHUTONG_DATA_DIR` selects a separate data scope when passed to the runtime.

## Panel controls

| Label | Meaning |
| --- | --- |
| 回答与细节 | Main answer, details, saved takeaways |
| 知识点 / 查看全部 | Records for this answer / all records |
| 设置 | Global threshold and feature switches |
| 查找 | Filter names or concept IDs in the current list |
| 调整 | Edit a display name and count together |
| 记录来源 | Up to 20 saved host/chat/turn identifiers |
| 最近记录与修正 | Refresh, inspect, and undo recent changes |
| 导出记录 | Export knowledge as JSON |
| 清除暂存详情 | Clear details, retaining knowledge |
| 清空记录 | Clear knowledge, receipts, audit history, and details after confirmation |

Checking a concept marks it known without adding explanations. **Unchecking clears its manual-known mark and resets its current count to zero.** Old receipts remain to prevent duplicate counting. Simply asking a follow-up does not reset anything.

Edits do not merge concepts or create aliases. If a record changes while you edit, saving is refused; **载入最新记录** replaces the draft with the latest values so you can adjust it again. Undo is limited to the latest effective change for that record.

Saved source counts can differ from current explanation counts after edits or undo. Sources are ordered by storage insertion, not occurrence time; receipts contain identifiers, not timestamps or conversation text.

## Change behavior

Use settings or ask in conversation: “Stop recording, but keep using existing records,” “Disable progressive details only in this chat,” or “For this answer, explain everything inline.”

| Setting | Effect |
| --- | --- |
| `enabled` | Automatic policy injection and recording |
| `profileEnabled` | Automatic profile reads and writes |
| `autoRecord` | Future automatic count updates |
| `adaptiveResponse` | Whether records influence answers |
| `suppressKnownConcepts` | Omission of familiar basics |
| `progressiveDetails` | Main-answer/detail presentation |
| `preferArtifacts` | Proactive selection of diagrams, tables, artifacts |
| `panelEnabled` | Automatic panel links; explicit panel requests still work |

All default to on. Overrides apply in order: defaults → global → exact domain → chat → answer. Panel edits are global; stronger overrides can still apply. Ask to clear an override to restore inheritance.

Turning features off preserves data and does not uninstall MCP tools or remove all host loading overhead. Explicit management requests remain available; requesting inspection can still return records to the model even when automatic profile access is off.

## Data controls and backups

The data directory contains `knowledge.sqlite` (concepts, threshold, aliases, receipts, audit), `settings.sqlite` (feature settings and overrides), and `turns/` (temporary selected content and turn state). Temporary details become inaccessible after 24 hours and are cleaned on a subsequent new turn, not by a background timer.

Operational files can include `panel.json` with an access token and `last-hook-error.json` with error information or local paths. ShuTong does not encrypt these files itself. OS permissions and device encryption are separate protections. Relevant records can enter the host's model context; there is no separate ShuTong cloud-sync or telemetry service.

Knowledge export includes concepts, threshold, optional aliases, and receipts. **It is not a complete settings/audit/detail backup.** After building, you can export and inspect a restore in a separate database:

```sh
mkdir -p local-data
node scripts/profile.mjs export > local-data/knowledge-backup.json
node scripts/profile.mjs --db ./local-data/restored.sqlite import < local-data/knowledge-backup.json
node scripts/profile.mjs --db ./local-data/restored.sqlite status
```

Replacing an existing profile requires explicit `import --replace` and overwrites it. `local-data/` is Git-ignored; keep exports out of issues and pull requests.

For full persistent configuration and audit backup, use SQLite's backup API for both databases, or stop all ShuTong-using host processes and the panel before copying the data directory. Copying a single live SQLite file is not a reliable complete backup. Full backup/restore is not automated in this preview.

## Update, disable, or uninstall

For a **new release with a different plugin manifest version**, update the checkout or download the source into a stable directory, then repeat the README's build, configuration, marketplace registration, and installation commands from that root. Start a new chat afterward. Do not also install a personal development copy.

Rebuilding an unchanged version during development can leave a cached copy in use. Use Codex's plugin-authoring update workflow and a new version/cache identifier; do not edit installed cache files.

To pause behavior, turn off **启用 ShuTong**. To uninstall the repository-marketplace copy:

```sh
codex plugin remove shutong@shutong-preview
codex plugin marketplace remove shutong-preview
```

Use your actual installed identity if it is `shutong@personal`; do not remove a marketplace shared by other plugins. Start a new chat or restart affected host processes to release old tools. Uninstalling the plugin does not clear the separate data directory. Use the panel's clear action before uninstalling to remove knowledge and temporary details; settings remain separate. To remove all local data, stop the host/plugin and panel, then remove your chosen ShuTong data directory yourself.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `codex plugin` is unavailable | Use a Codex version with the required commands, or the standalone Skill. Other hosts do not yet have automatic tracking. |
| No effect in an existing chat | Start a new chat; check `codex plugin list`, effective settings, and hook trust. Simple answers can legitimately omit detail links. |
| MCP fails after moving files | Rebuild, rerun `configure-local-plugin.mjs`, and reinstall from the new stable location. |
| Hooks await approval | Review UserPromptSubmit, Stop, and Interrupt in Codex. Do not disable sandboxing or global approvals. |
| Panel link stopped working | Ask “Open the ShuTong panel.” A server restart, idle timeout, or upgrade invalidates old links; details also expire after 24 hours. |
| Diagram shows source | Unsupported types, custom configuration, excessive size, invalid syntax, or rendering failures fall back to source. |
| A concept is explained again | Explicit requests, name-matching failures, or setting overrides may cause this. Counts do not force every model decision. |
| No new count after expansion | The detail may have no eligible explanatory evidence, recording may be off, or this answer was already counted. |
| Node prints an experimental SQLite warning | This preview uses node:sqlite; the warning alone does not mean the operation failed. Inspect the exit status and actual error. |
| Tests cannot bind a port | Integration tests need temporary loopback listeners; use a local environment that permits them without disabling unrelated protections. |
| `ERR_PNPM_UNEXPECTED_STORE` | Reuse the checkout's original store with `--store-dir`, or install normally in a clean checkout. No global configuration change is required. |

`pnpm probe:codex` checks protocol support without invoking a model; it does not prove live plugin execution. The script's `--installed` option currently targets the developer identity `shutong@personal`, so do not use it to diagnose a `shutong-preview` installation.

## Feedback

Reading comfort is the primary outcome. Provide a small synthetic or redacted example, expected behavior, OS and Node/pnpm/Codex versions, installed plugin identity, and effective settings. See [CONTRIBUTING](../CONTRIBUTING.md) and [SECURITY](../SECURITY.md).
