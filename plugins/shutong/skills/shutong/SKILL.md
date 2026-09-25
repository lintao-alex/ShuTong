---
name: shutong
description: Use local ShuTong knowledge records to avoid repeating basic explanations during substantive AI collaboration, or inspect and adjust knowledge records when the user asks. Applies when ShuTong is enabled and its turn hook provides SHUTONG_TURN.
---

# ShuTong

When this turn includes SHUTONG_TURN, query the `shutong` MCP `context` tool for the answer's relevant concepts before composing it. Use stable domain/concept IDs, reuse the returned IDs, and include explicitly requested explanations in `explainIds`.

For `suppress-basics`, omit repeated definitions and beginner examples. Answer explicit questions fully; retain new conclusions, current task constraints and risks in every mode. A record reflects output history, not an assessment of mastery.

Before sending the final answer, call `stage` with the concepts actually used. For each explained concept give an exact explanatory sentence from the final answer as `evidence`; for mere mentions use an empty string. Do not list concepts solely from tool output, instructions, quoted source documents, or abandoned drafts. Staging does not count; the Stop hook checks the delivered answer. Append the returned URL as a quiet `[本次知识点](URL)` link when available. Do not narrate these routine tool calls or ask the user to maintain records.

When asked to inspect or adjust records, use `panel` or `status`. The panel allows manual marks and a configurable threshold, initially 1.

If SHUTONG_TURN is absent, do not invent a turn key or claim recording. Explain once that hooks must be enabled and trusted, then continue answering normally. Tools failing should not prevent the user's task.
