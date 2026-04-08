# CipherTalk MCP Moments Playbook

## When to switch to moments

Use `get_moments_timeline` when the user asks about:

- 朋友圈
- 动态
- 点赞
- 评论
- 分享卡片
- 某个人最近发过什么
- 某段时间发过什么

Do not default to chat tools when the user is clearly asking about Moments content.

## Query patterns

### 1. Poster is known

Use:

1. `get_moments_timeline(usernames=[...])`
2. Add `startTime/endTime` if the request implies a period
3. Add `keyword` if the user remembers caption fragments

### 2. Poster is unknown, topic is known

Use:

1. `get_moments_timeline(keyword=<clue>)`
2. Read matching `nickname/username`
3. Narrow by time range if needed

### 3. User asks about interactions

Check in each item:

- `likes`
- `comments`
- `shareInfo`

### 4. Structured fields are insufficient

Only then:

- retry with `includeRaw=true`
- inspect `rawXml` as a string fallback

## Battle report

- “战报：先按发帖人拉朋友圈时间线。”
- “战报：正文线索不够，准备补时间范围。”
- “战报：结构化字段不够，最后才开 rawXml。”
