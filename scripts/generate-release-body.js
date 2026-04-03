const fs = require('fs')
const path = require('path')

const rootDir = path.resolve(__dirname, '..')
const releaseDir = path.join(rootDir, 'release')
const contextPath = path.join(releaseDir, 'release-context.json')
const outputPath = path.join(releaseDir, 'release-body.md')

function parseEnvText(content) {
  const result = {}
  for (const line of String(content || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex <= 0) continue
    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

function loadLocalSecretEnv() {
  const candidates = [
    path.join(rootDir, '.release.local.env'),
    path.join(rootDir, '.env.local')
  ]

  const merged = {}
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue
    try {
      const parsed = parseEnvText(fs.readFileSync(filePath, 'utf8'))
      Object.assign(merged, parsed)
      console.log(`[ReleaseBody] Loaded local env file: ${path.basename(filePath)}`)
    } catch (e) {
      console.warn(`[ReleaseBody] Failed to read local env file: ${filePath}`, String(e))
    }
  }
  return merged
}

const localSecrets = loadLocalSecretEnv()
const aiApiKey = process.env.AI_API_KEY || localSecrets.AI_API_KEY || ''
const aiApiUrl = process.env.AI_API_URL || localSecrets.AI_API_URL || 'https://api.openai.com/v1/chat/completions'
const aiModel = process.env.AI_MODEL || localSecrets.AI_MODEL || 'gpt-5.4'

const PRIMARY_AUTHOR_LOGINS = new Set(['ILoveBingLu'])
const PRIMARY_AUTHOR_NAMES = new Set(['ILoveBingLu', 'BingLu', 'ILoveBinglu'])

function isPrimaryAuthor(person) {
  if (!person) return false
  const login = String(person.authorLogin || '').trim()
  const name = String(person.authorName || '').trim()
  return PRIMARY_AUTHOR_LOGINS.has(login) || PRIMARY_AUTHOR_NAMES.has(name)
}

function classifyCommit(subject) {
  const normalized = String(subject || '').toLowerCase()
  if (normalized.startsWith('feat')) return '新增'
  if (normalized.startsWith('fix')) return '修复'
  return '调整'
}

function buildThanks(context) {
  const lines = []

  for (const pr of context.pullRequests || []) {
    if (!isPrimaryAuthor({ authorLogin: pr.authorLogin, authorName: pr.authorName })) {
      lines.push(`- 感谢 @${pr.authorLogin} 提交 PR #${pr.number}《${pr.title}》`)
    }
  }

  const prNumbers = new Set((context.pullRequests || []).map((pr) => pr.number))
  for (const commit of context.commits || []) {
    const hasPrRef = /#(\d+)/.test(commit.subject || '')
    if (hasPrRef) continue
    if (!isPrimaryAuthor(commit)) {
      lines.push(`- 感谢 ${commit.authorName} 提交改动《${commit.subject}》`)
    }
  }

  return Array.from(new Set(lines))
}

function buildReferences(context) {
  const lines = []
  for (const pr of context.pullRequests || []) {
    lines.push(`- PR #${pr.number}: [${pr.title}](${pr.url})`)
  }
  for (const commit of context.commits || []) {
    lines.push(`- Commit [${commit.shortSha}](${commit.url}): ${commit.subject}`)
  }
  return lines
}

function buildFallbackBody(context) {
  const groups = {
    新增: [],
    修复: [],
    调整: []
  }

  for (const commit of context.commits || []) {
    groups[classifyCommit(commit.subject)].push(`- ${commit.subject}（${commit.shortSha}）`)
  }

  const thanks = buildThanks(context)
  const references = buildReferences(context)
  const blockedVersions = context.forceUpdate?.blockedVersions || []
  const hasUpgradeReminder = Boolean(context.forceUpdate?.minimumSupportedVersion || blockedVersions.length > 0)

  return [
    `## CipherTalk ${context.tag}`,
    '',
    '### 概览',
    `本版本包含 ${context.commits.length} 条提交，涉及 ${(context.pullRequests || []).length} 个 PR。`,
    '',
    '### 新增',
    ...(groups.新增.length ? groups.新增 : ['- 无']),
    '',
    '### 修复',
    ...(groups.修复.length ? groups.修复 : ['- 无']),
    '',
    '### 调整',
    ...(groups.调整.length ? groups.调整 : ['- 无']),
    '',
    ...(hasUpgradeReminder ? [
      '### 升级提醒',
      ...(context.forceUpdate.minimumSupportedVersion ? [`- 最低安全版本：${context.forceUpdate.minimumSupportedVersion}`] : []),
      ...(blockedVersions.length ? [`- 封禁版本：${blockedVersions.join(', ')}`] : []),
      ''
    ] : []),
    '### 感谢贡献者',
    ...(thanks.length ? thanks : ['- 本版本无新增外部贡献']),
    '',
    '### 相关提交与 PR',
    ...(references.length ? references : ['- 无']),
    ''
  ].join('\n')
}

function isValidAiBody(body) {
  if (!body) return false
  return body.includes('## CipherTalk') && body.includes('### 感谢贡献者') && body.includes('### 相关提交与 PR')
}

function logAiConfig() {
  console.log('[ReleaseBody] AI config:')
  console.log(`  apiUrl=${aiApiUrl}`)
  console.log(`  model=${aiModel}`)
  console.log(`  apiKeyConfigured=${Boolean(aiApiKey)}`)
  console.log(`  usingDefaultApiUrl=${!process.env.AI_API_URL}`)
  console.log(`  usingDefaultModel=${!process.env.AI_MODEL}`)
}

async function generateAiBody(context) {
  if (!aiApiKey) {
    throw new Error('AI_API_KEY 未配置')
  }

  logAiConfig()

  const systemPrompt = [
    '你是一个发布说明撰写助手。',
    '只能基于输入中的 commits 和 pull requests 生成，不得编造任何功能或修复。',
    '输出必须是中文 Markdown，风格尽量自然，不要机械复读。',
    '为保证格式一致性：优先使用以下标题结构（即使某一类内容为空也要写出对应章节，并在该章节内标注“无/未检测到”）：',
    '## CipherTalk vX.Y.Z',
    '### 概览',
    '### 新增',
    '### 修复',
    '### 调整',
    '### 感谢贡献者',
    '### 相关提交与 PR',
    '如果存在最低安全版本或封禁版本，增加 ### 升级提醒 章节。',
    '分类建议：可参考提交标题前缀 feat/fix 做粗分类到 新增/修复；其余放到 调整（如果标题无法判断，就放到 调整）。',
    '引用规则：',
    '有 PR 时优先引用 PR 标题；没有 PR 时才引用 commit 标题。',
    '列表尽量短：最多每类列出 5 条最关键的标题；其余可在概览里用一句话说明总量。',
    '感谢规则：只有非主作者的 PR/commit 才出现在感谢段；主作者按代码中的逻辑是 ILoveBingLu（及其大小写/拼写变体）相关。',
    '不要写猜测：如果输入里没有足够信息，就用“无/未检测到”或“仅维护性发布”描述。'
  ].join('\n')

  const userPrompt = `请根据以下发布上下文为 ${context.tag} 生成标准化发布说明：\n\n${JSON.stringify(context, null, 2)}`
  const startedAt = Date.now()
  console.log(`[ReleaseBody] AI request start for ${context.tag}`)

  const response = await fetch(aiApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aiApiKey}`
    },
    body: JSON.stringify({
      model: aiModel,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  })

  const durationMs = Date.now() - startedAt
  console.log(`[ReleaseBody] AI response received status=${response.status} durationMs=${durationMs}`)

  if (!response.ok) {
    const raw = await response.text()
    console.error(`[ReleaseBody] AI response error body=${raw}`)
    throw new Error(`AI 请求失败: ${response.status}`)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content
  console.log(`[ReleaseBody] AI content length=${typeof content === 'string' ? content.length : 0}`)
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('AI 返回内容为空')
  }

  const body = content.trim()
  if (!isValidAiBody(body)) {
    console.error('[ReleaseBody] AI output preview:')
    console.error(body.slice(0, 1000))
    throw new Error('AI 返回内容不符合格式要求')
  }

  console.log('[ReleaseBody] AI output validated successfully')

  return body
}

async function main() {
  if (!fs.existsSync(contextPath)) {
    throw new Error(`未找到 release context: ${contextPath}`)
  }

  const context = JSON.parse(fs.readFileSync(contextPath, 'utf8'))

  let body
  try {
    body = await generateAiBody(context)
    console.log('✅ 已生成 AI Release Body')
  } catch (error) {
    console.warn('⚠️ AI 生成失败，回退到模板正文：', String(error))
    body = buildFallbackBody(context)
    console.log(`[ReleaseBody] Fallback body length=${body.length}`)
  }

  fs.writeFileSync(outputPath, `${body.trim()}\n`, 'utf8')
  console.log(`✅ release-body.md 已生成: ${outputPath}`)
  console.log(`[ReleaseBody] Final body length=${body.trim().length}`)
}

main().catch((error) => {
  console.error('❌ 生成 release-body.md 失败:', error)
  process.exit(1)
})
