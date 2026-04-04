---
name: ct-mcp-copilot
description: Use CipherTalk MCP as an AI copilot for contact lookup, session resolution, message search, context retrieval, and chat analytics. Trigger when the user provides partial, fuzzy, mistaken, or incomplete clues such as nicknames, remarks, organization fragments, typo-prone names, or half-remembered keywords, or wants the AI to proactively dig for more data instead of stopping after one failed query.
---

# ct-mcp-copilot

Use CipherTalk MCP like a patient investigator, not like a rigid database client.

## Core behavior

1. Start broad, then narrow.
2. Treat `list_contacts` and `list_sessions` as fuzzy entry points.
3. Assume the user may remember only part of the truth.
4. Do not stop after the first miss.
5. When multiple candidates exist, compare them and keep shrinking the set.

## Default routing

1. If the user describes a person loosely, start with both `list_contacts` and `list_sessions`.
2. When the clue is especially fuzzy or typo-prone, prefer `resolve_session` first to get candidates, confidence, and the recommended next action.
3. If the target is still unclear, compare remark, nickname, display name, recent timestamp, and session kind.
4. Once one session becomes the best candidate, switch to `get_messages` or `get_session_context`.
5. If the user wants more clues or the session is still uncertain, use `search_messages` across multiple sessions or globally.
6. Use analytics tools only after the target scope is reasonably stable.

## Fuzzy clue strategy

When the user gives weak clues such as a nickname fragment, an organization fragment, a possibly mistyped name, or a half-remembered phrase:

- Search contacts and sessions in parallel.
- Use fragment matches, nickname matches, remark matches, and organization-name matches.
- Prefer candidates with recent activity when the user implies recency.
- If a keyword is uncertain, search globally before concluding there is no evidence.
- If one query misses, reformulate the clue and try another route.

## Candidate handling

When there are multiple plausible candidates:

- Do not pretend the result is unique.
- Read `resolve_session.candidates[*].evidence` before choosing.
- Compare the top candidates using recent message preview, session kind, and contact aliases.
- Explain which candidate is currently strongest and why.
- If needed, inspect each candidate’s latest context before answering.

When `resolve_session` returns a recommendation:

- Treat `recommended.confidence` as a hint, not a blind verdict.
- Use `recommended.evidence` to explain why this candidate is strongest.
- If confidence is only `medium` or `low`, verify with `get_session_context` or `search_messages` before committing.

When `search_messages` returns global or multi-session hits:

- Read `sessionSummaries` first.
- Use `sessionSummaries` to see which session is accumulating the strongest evidence.
- Use `sampleExcerpts` to decide whether to keep narrowing, switch sessions, or confirm the lead.

## Battle report

After each meaningful exploration round, produce a very short battle report for yourself or the user:

- “战报：已锁定 3 个候选，下一步按备注和最近消息区分。”
- “战报：会话还不唯一，准备全局搜关键词补证据。”
- “战报：已确认目标会话，开始拉最近上下文。”

Keep it short. It should help trace the reasoning, not overshadow the answer.

## Export workflow

When the user asks to export chat history:

1. Check whether the request already includes:
   - target session
   - time range
   - export format
   - media selections
2. If the target is fuzzy, resolve it first with `resolve_session`.
3. If the target is still ambiguous, keep narrowing and do not export yet.
4. Use `export_chat(validateOnly=true)` to audit whether the request is complete.
5. If `missingFields` is non-empty, prefer `followUpQuestions`; otherwise fall back to `nextQuestion`.
6. Ask follow-up questions until the missing fields are all resolved.
7. Prefer the configured default export directory when it exists and is writable.
8. If the default export directory is unavailable, ask the user for an output directory.
9. Only call `export_chat` without `validateOnly` after the request is complete.

When asking follow-up questions for export:

- ask only for missing fields
- do not ask again for fields the user already confirmed
- treat media selections as required and explicit
- do not silently assume a time range

After export finishes, summarize:

- which session was exported
- the time range
- the format
- which media were included
- where the files were written

## Never do this

- Do not conclude “没有数据” after a single failed query.
- Do not insist on exact `sessionId` when fuzzy resolution is possible.
- Do not ignore `hint` or candidate summaries returned by MCP.
- Do not ignore `evidence` on resolved candidates or `sessionSummaries` on search results.
- Do not lock onto a candidate while ambiguity is still obvious.
- Do not start exporting before target session, time range, format, and media selections are all confirmed.
- Do not quietly choose a time range or media mix on the user’s behalf.

## References

- Read [references/queries.md](references/queries.md) when you need concrete fuzzy-query playbooks, fallback chains, or battle-report examples.
- Read [references/export.md](references/export.md) when the user asks to export chat history.
