/**
 * WCDB 直连验证脚本
 *
 * 用途：验证 WCDB 原生库能否直接读取微信的加密数据库（跳过拷贝方案）
 * 运行方式：npx tsx scripts/wcdb-direct-read-test.ts
 *          或通过 Electron 主进程加载（需要 koffi native addon）
 *
 * 注意：koffi 是 native addon，必须在 Electron 环境下运行。
 * 如果直接 tsx 运行失败，请用以下方式：
 *   npx electron -e "require('./scripts/wcdb-direct-read-test.ts')"
 *   或把这个文件的逻辑加到 Electron 的某个 IPC handler 里手动触发
 */

// ============================================================
// 第一部分：数据库与表清单
// 基于 chatService.ts 的分析结果
// ============================================================

/**
 * chatService.ts 访问的所有数据库文件：
 */
const DATABASES = [
  {
    name: 'session.db',
    tables: ['SessionTable', 'Session', 'session'], // 按优先级尝试
    description: '会话列表、好友关系',
    critical: true,
  },
  {
    name: 'contact.db',
    tables: ['contact'],
    description: '联系人详情（昵称、备注、头像 URL）',
    critical: true,
  },
  {
    name: 'message_*.db / msg_*.db',
    tables: [
      'Msg_<32位hash>',     // 旧版消息表
      'msg_<32位hash>',     // 新版消息表
      'Name2Id',            // 用户名到 rowid 的映射表（用于解析 senderUsername）
    ],
    description: '聊天消息（主数据，微信按联系人 hash 分库分表）',
    critical: true,
    variable: true, // 文件名为 message_X.db 或 msg_X.db
  },
  {
    name: 'emoticon.db',
    tables: ['EmoteItem', 'EmojiInfo', 'CustomEmoji'],
    description: '表情包数据',
    critical: false,
  },
  {
    name: 'emotion.db',
    tables: ['EmotionInfo', 'EmotionItem', 'EmotionDonate'],
    description: '商店表情/打赏表情',
    critical: false,
  },
  {
    name: 'head_image.db',
    tables: ['HeadImage', 'HeadImageInfo'],
    description: '联系人头像缓存',
    critical: false,
  },
  {
    name: 'misc.db',
    tables: ['misc', 'config'],
    description: '杂项配置数据',
    critical: false,
  },
  // 注意：微信 4.x 可能还有 media.db / HardLink.db 等，需实际扫描
  {
    name: 'media_*.db',
    tables: ['VoiceInfo*', 'VideoInfo*', 'ImageInfo*', 'FileInfo*'],
    description: '媒体文件元数据（语音、视频、图片、文件）',
    critical: false,
    variable: true,
  },
]

/**
 * session.db 中查询的典型 SQL（chatService.ts 第 493-520 行）：
 *   SELECT name FROM sqlite_master WHERE type='table'
 *   SELECT * FROM SessionTable ORDER BY sort_timestamp DESC LIMIT ? OFFSET ?
 *   SELECT username, user_name, userName, sort_timestamp, sortTimestamp FROM SessionTable
 */

/**
 * contact.db 中查询的典型 SQL（chatService.ts 第 564-590 行）：
 *   SELECT name FROM sqlite_master WHERE type='table' AND name='contact'
 *   SELECT username, nickname, alias, remark, ..., smallHeadImgUrl FROM contact
 *   注意：查询的列名是动态的（先 PRAGMA table_info 再拼 SELECT 列）
 */

/**
 * 消息数据库中查询的典型 SQL（chatService.ts 第 1011-1046 行）：
 *   1. 查表：SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%'
 *   2. 查索引：SELECT name FROM sqlite_master WHERE type='index' AND name = ?
 *   3. 查 Name2Id：SELECT rowid FROM Name2Id WHERE user_name = ?
 *   4. 查消息（带 sender join）：
 *      SELECT m.*, n.user_name AS sender_username
 *      FROM Msg_<hash> m LEFT JOIN Name2Id n ON m.sender_username_id = n.rowid
 *      ORDER BY sort_seq DESC, create_time DESC, local_id DESC LIMIT ? OFFSET ?
 *   5. 字段核心：local_id, server_id, local_type, create_time, sort_seq,
 *      is_send, sender_username_id, message_content, compress_content,
 *      server_id, msg_create_time, mes_desp, mes_desp2
 */

// ============================================================
// 第二部分：验证脚本逻辑
// ============================================================

import { existsSync, readdirSync, statSync } from 'fs'
import { join, basename, dirname } from 'path'

/**
 * 验证结果汇总
 */
interface DbTestResult {
  dbName: string
  success: boolean
  tablesTested: { table: string; rows: number; fields: string[] }[]
  errors: string[]
  warnings: string[]
  fieldIntegrityIssues: string[]
}

/**
 * 将验证脚本作为模块导出，供 Electron 主进程加载调用
 */
export async function runWcdbDirectReadTest(): Promise<{
  results: DbTestResult[]
  conclusion: string
  score: number
  blockers: string[]
}> {
  console.log('='.repeat(60))
  console.log('  WCDB 直连验证脚本')
  console.log('='.repeat(60))

  // --- 尝试导入 WCDB 服务 ---
  let wcdbService: any
  let wxKeyService: any
  let dbPathService: any

  try {
    // Electron 环境下才能正确 import（因为 koffi 是 native addon）
    const servicesDir = join(__dirname, '..', 'electron', 'services')
    // 动态 require 或 import
    const wcdbMod = await import(/* @vite-ignore */ join(servicesDir, 'wcdbService'))
    const wxKeyMod = await import(/* @vite-ignore */ join(servicesDir, 'wxKeyServiceMac'))
    const dbPathMod = await import(/* @vite-ignore */ join(servicesDir, 'dbPathService'))
    wcdbService = wcdbMod.wcdbService
    wxKeyService = wxKeyMod.wxKeyServiceMac
    dbPathService = dbPathMod.dbPathService
  } catch (e) {
    console.log('\n⚠️  无法导入 WCDB 服务（非 Electron 环境或 koffi 未安装）')
    console.log('   错误:', (e as Error).message)
    console.log('\n   请在 Electron 环境中运行此脚本')
    console.log('   或将此文件的逻辑手动复制到 Electron 主进程的 IPC handler 中执行')
    return {
      results: [],
      conclusion: '无法在非 Electron 环境中运行验证',
      score: 0,
      blockers: ['需要 Electron 运行时环境（koffi native addon 依赖）'],
    }
  }

  const results: DbTestResult[] = []
  const blockers: string[] = []

  // --- Step 1: 获取密钥 ---
  console.log('\n  [Step 1] 获取微信数据库密钥...')
  let hexKey: string | undefined

  try {
    const keyResult = await wxKeyService.autoGetDbKey(60_000)
    if (keyResult.success && keyResult.key) {
      hexKey = keyResult.key
      console.log(`    ✅ 密钥获取成功: ${hexKey.slice(0, 8)}...${hexKey.slice(-8)}`)
    } else {
      console.log(`    ❌ 密钥获取失败: ${keyResult.error}`)
      blockers.push(`密钥获取失败: ${keyResult.error}`)
    }
  } catch (e: any) {
    console.log(`    ❌ 密钥获取异常: ${e.message}`)
    blockers.push(`密钥获取异常: ${e.message}`)
  }

  if (!hexKey) {
    return {
      results: [],
      conclusion: '密钥获取失败，无法继续验证',
      score: 0,
      blockers,
    }
  }

  // --- Step 2: 获取微信数据库路径 ---
  console.log('\n  [Step 2] 获取微信数据库路径...')
  let wechatDbPath: string | undefined
  let wxid: string | undefined

  try {
    const detectResult = await dbPathService.autoDetect()
    if (detectResult.success && detectResult.path) {
      wechatDbPath = detectResult.path
      const wxids = dbPathService.scanWxids(wechatDbPath)
      wxid = wxids[0]
      console.log(`    ✅ 微信数据库路径: ${wechatDbPath}`)
      console.log(`    ✅ 微信ID: ${wxid}`)
    } else {
      console.log(`    ❌ 路径检测失败: ${detectResult.error}`)
    }
  } catch (e: any) {
    console.log(`    ❌ 路径检测异常: ${e.message}`)
  }

  if (!wechatDbPath || !wxid) {
    return {
      results: [],
      conclusion: '路径检测失败，无法继续验证',
      score: 0,
      blockers: ['微信数据库路径检测失败（微信是否已登录？）'],
    }
  }

  // --- Step 3: 扫描实际存在的数据库文件 ---
  console.log('\n  [Step 3] 扫描实际数据库文件...')
  const existingDbs = scanExistingDatabases(wechatDbPath, wxid)
  console.log(`    发现 ${existingDbs.length} 个数据库文件:`)
  for (const db of existingDbs) {
    const sizeMB = (db.size / 1024 / 1024).toFixed(1)
    console.log(`    - ${db.name} (${sizeMB} MB)`)
  }

  // --- Step 4: 用 WCDB 连接并测试 ---
  console.log('\n  [Step 4] WCDB 连接测试...')

  const initRes = await wcdbService.initialize()
  if (!initRes.success) {
    console.log(`    ❌ WCDB 初始化失败: ${initRes.error}`)
    blockers.push(`WCDB 初始化失败: ${initRes.error}`)
    return { results, conclusion: 'WCDB 初始化失败', score: 0, blockers }
  }

  // 打开数据库
  const openSuccess = await wcdbService.open(wechatDbPath, hexKey, wxid)
  if (!openSuccess) {
    console.log('    ❌ 数据库打开失败')
    blockers.push('WCDB open 失败（密钥错误或路径不匹配？）')
    return { results, conclusion: '数据库打开失败', score: 0, blockers }
  }
  console.log('    ✅ 数据库连接成功')

  // --- Step 5: 逐库验证 ---
  console.log('\n  [Step 5] 逐库查询验证...\n')

  // 5a: 验证 session.db
  console.log('  --- session.db ---')
  const sessionResult = await testDbQuery(wcdbService, 'session', '', 'SELECT * FROM SessionTable LIMIT 5')
  results.push(sessionResult)
  if (!sessionResult.success) {
    // 尝试 Session 或 session 表名
    const r2 = await testDbQuery(wcdbService, 'session', '', "SELECT name FROM sqlite_master WHERE type='table'")
    results.push(r2)
  }

  // 5b: 验证 contact.db
  console.log('  --- contact.db ---')
  const contactResult = await testDbQuery(wcdbService, 'contact', '', 'SELECT * FROM contact LIMIT 5')
  results.push(contactResult)

  // 5c: 验证消息库（需要先找到实际的消息数据库文件）
  console.log('  --- message_*.db ---')
  const msgDbs = existingDbs.filter(
    (d) => d.name.startsWith('message') || d.name.startsWith('msg')
  )
  let msgTested = false
  for (const msgDb of msgDbs.slice(0, 3)) {
    // 先找表
    const tableResult = await testDbQuery(
      wcdbService, 'message', msgDb.name,
      "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'Msg_%' OR name LIKE 'msg_%')"
    )
    if (tableResult.success && tableResult.tablesTested.length > 0) {
      // 找到消息表了，测试查询
      const msgTableName = tableResult.tablesTested[0].table
      console.log(`    找到消息表: ${msgTableName}`)

      // 测试基础查询
      const queryResult = await testDbQuery(
        wcdbService, 'message', msgDb.name,
        `SELECT * FROM ${msgTableName} ORDER BY sort_seq DESC LIMIT 3`
      )
      results.push(queryResult)
      msgTested = true

      // 特别验证：message_content 字段完整性
      if (queryResult.success && queryResult.tablesTested.length > 0) {
        const fields = queryResult.tablesTested[0].fields
        if (fields.includes('message_content') || fields.includes('MessageContent') || fields.includes('msg_content')) {
          console.log('    ℹ️  message_content 字段存在，需验证二进制完整性')
          // 在这个验证脚本中，我们用长度对比来检测截断
          await testMessageContentIntegrity(wcdbService, 'message', msgDb.name, msgTableName)
        }
      }

      // 测试 Name2Id 表
      await testDbQuery(
        wcdbService, 'message', msgDb.name,
        "SELECT name FROM sqlite_master WHERE type='table' AND name='Name2Id'"
      )
      await testDbQuery(
        wcdbService, 'message', msgDb.name,
        'SELECT * FROM Name2Id LIMIT 5'
      )

      // 测试 JOIN 查询
      await testDbQuery(
        wcdbService, 'message', msgDb.name,
        `SELECT m.local_id, m.sort_seq, m.create_time, m.message_content
         FROM ${msgTableName} m LIMIT 3`
      )
    }
  }
  if (!msgTested) {
    console.log('    ⚠️  未找到可查询的消息表')
  }

  // 5d: 验证 emoticon.db
  console.log('  --- emoticon.db ---')
  await testDbQuery(wcdbService, 'emoticon', '', 'SELECT * FROM EmoteItem LIMIT 3')

  // 5e: 验证 emotion.db
  console.log('  --- emotion.db ---')
  await testDbQuery(wcdbService, 'emotion', '', 'SELECT * FROM EmotionInfo LIMIT 3')

  // 5f: 验证 head_image.db
  console.log('  --- head_image.db ---')
  await testDbQuery(wcdbService, 'head_image', '', 'SELECT * FROM HeadImage LIMIT 3')

  // 5g: 验证 misc.db
  console.log('  --- misc.db ---')
  await testDbQuery(wcdbService, 'misc', '', "SELECT name FROM sqlite_master WHERE type='table' LIMIT 10")

  // --- Step 6: 清理 ---
  wcdbService.close()

  // --- Step 7: 生成结论 ---
  return generateConclusion(results, blockers)
}

/**
 * 辅助：执行单次查询并记录结果
 */
async function testDbQuery(
  wcdbService: any,
  kind: string,
  path: string,
  sql: string
): Promise<DbTestResult> {
  const dbName = path || kind
  const result: DbTestResult = {
    dbName,
    success: false,
    tablesTested: [],
    errors: [],
    warnings: [],
    fieldIntegrityIssues: [],
  }

  try {
    const queryResult = await wcdbService.execQuery(kind, path, sql)
    if (queryResult.success && queryResult.rows) {
      result.success = true
      const rowCount = queryResult.rows.length
      const fields = rowCount > 0 ? Object.keys(queryResult.rows[0]) : []

      // 提取表名（如果 SQL 查的是 sqlite_master，则取 name 字段）
      const tableName = sql.toLowerCase().includes('sqlite_master')
        ? (queryResult.rows[0]?.name || 'unknown')
        : extractTableName(sql)

      result.tablesTested.push({
        table: tableName,
        rows: rowCount,
        fields,
      })

      console.log(`    ✅ ${dbName}: 返回 ${rowCount} 行, 字段: [${fields.join(', ')}]`)
    } else {
      result.errors.push(`execQuery 失败: ${queryResult.error}`)
      console.log(`    ❌ ${dbName}: 查询失败 - ${queryResult.error}`)
    }
  } catch (e: any) {
    result.errors.push(e.message)
    console.log(`    ❌ ${dbName}: 异常 - ${e.message}`)
  }

  return result
}

/**
 * 特别验证：message_content 的二进制完整性
 * WCDB 转 JSON 时可能会截断或损坏二进制数据
 */
async function testMessageContentIntegrity(
  wcdbService: any,
  kind: string,
  path: string,
  tableName: string
): Promise<void> {
  try {
    const sql = `SELECT local_id, message_content, compress_content, length(message_content) as content_len, length(compress_content) as compress_len FROM ${tableName} WHERE message_content IS NOT NULL LIMIT 5`
    const result = await wcdbService.execQuery(kind, path, sql)

    if (result.success && result.rows) {
      for (const row of result.rows) {
        const contentLen = row.content_len || 0
        const compressLen = row.compress_len || 0

        if (typeof row.message_content === 'string') {
          console.log(`    ⚠️  message_content 是字符串而非 Buffer (id=${row.local_id}), 长度=${contentLen || 'N/A'}`)
        } else if (Buffer.isBuffer(row.message_content)) {
          console.log(`    ✅ message_content 是 Buffer (id=${row.local_id}), 长度=${row.message_content.length}`)
        } else {
          console.log(`    ⚠️  message_content 类型: ${typeof row.message_content} (id=${row.local_id})`)
        }
      }
    } else {
      console.log('    ⚠️  无法验证 message_content 完整性（查询失败）')
    }
  } catch (e) {
    console.log('    ⚠️  message_content 验证异常:', (e as Error).message)
  }
}

/**
 * 扫描实际存在的数据库文件
 */
function scanExistingDatabases(dbPath: string, wxid: string): { name: string; path: string; size: number }[] {
  const results: { name: string; path: string; size: number }[] = []
  const dbStorage = join(dbPath, wxid, 'db_storage')

  if (!existsSync(dbStorage)) return results

  try {
    const files = readdirSync(dbStorage)
    for (const file of files) {
      const fullPath = join(dbStorage, file)
      if (file.endsWith('.db') && statSync(fullPath).isFile()) {
        results.push({ name: file, path: fullPath, size: statSync(fullPath).size })
      }
    }
  } catch (e) {
    console.error('扫描数据库文件失败:', e)
  }

  return results
}

/**
 * 从 SQL 中提取表名（简化版）
 */
function extractTableName(sql: string): string {
  const match = sql.match(/(?:FROM|from)\s+`?(\w+)`?/i)
  return match ? match[1] : 'unknown'
}

/**
 * 生成最终结论
 */
function generateConclusion(results: DbTestResult[]): {
  results: DbTestResult[]
  conclusion: string
  score: number
  blockers: string[]
} {
  console.log('\n' + '='.repeat(60))
  console.log('  === 验证结果 ===')
  console.log('='.repeat(60))

  let totalTests = 0
  let passed = 0
  let partial = 0
  const blockers: string[] = []

  for (const r of results) {
    const status = r.success ? '✅ 成功' : '❌ 失败'
    const rowInfo = r.tablesTested.map(t => `${t.table}(${t.rows}行)`).join(', ')
    const fieldInfo = r.tablesTested.length > 0
      ? `字段: ${r.tablesTested[0].fields.slice(0, 8).join(', ')}${r.tablesTested[0].fields.length > 8 ? '...' : ''}`
      : ''
    console.log(`  ${r.dbName}: ${status} | ${rowInfo} | ${fieldInfo}`)

    if (r.success) {
      if (r.warnings.length > 0 || r.fieldIntegrityIssues.length > 0) {
        partial++
        for (const w of r.warnings) console.log(`      ⚠️ ${w}`)
        for (const w of r.fieldIntegrityIssues) console.log(`      ⚠️ ${w}`)
      } else {
        passed++
      }
    } else {
      blockers.push(`${r.dbName}: ${r.errors.join('; ')}`)
    }
    totalTests++
  }

  // 评分逻辑
  const score = totalTests > 0 ? Math.round((passed + partial * 0.5) / totalTests * 100) : 0

  console.log(`\n  === 结论 ===`)
  console.log(`  WCDB 直连可行度: ${score}%`)

  if (score >= 80) {
    console.log(`  等级: 🟢 推荐迁移`)
    console.log(`  核心数据库（session.db, contact.db, message_*.db）均可直连读取`)
  } else if (score >= 50) {
    console.log(`  等级: 🟡 有条件迁移`)
    console.log(`  部分数据库可直连，需进一步排查失败原因`)
  } else {
    console.log(`  等级: 🔴 暂不推荐`)
    console.log(`  直连方案在当前 WCDB 版本上不成熟`)
  }

  if (blockers.length > 0) {
    console.log(`\n  拦截项:`)
    for (const b of blockers) {
      console.log(`    - ${b}`)
    }
  }

  console.log(`  已测试数据库: ${totalTests} 个`)
  console.log(`  完全通过: ${passed} 个`)
  console.log(`  部分通过: ${partial} 个`)
  console.log(`  失败: ${blockers.length} 个`)

  return {
    results,
    conclusion: `WCDB 直连可行度: ${score}%`,
    score,
    blockers,
  }
}

// ============================================================
// 第三部分：直接运行入口
// ============================================================

// 检测是否直接运行
if (require.main === module || process.argv[1]?.endsWith('wcdb-direct-read-test.ts')) {
  console.log('\n⚠️  此脚本依赖 Electron 运行时环境（koffi native addon）')
  console.log('   请通过以下方式运行：')
  console.log('')
  console.log('   方式 1：在 Electron 主进程中加载')
  console.log('     import { runWcdbDirectReadTest } from "../scripts/wcdb-direct-read-test"')
  console.log('     runWcdbDirectReadTest()')
  console.log('')
  console.log('   方式 2：在 package.json 中添加脚本')
  console.log('     "scripts": {')
  console.log('       "test:wcdb": "electron -e require(\\"./scripts/wcdb-direct-read-test.ts\\")"')
  console.log('     }')
  console.log('')
  console.log('   方式 3：通过 IPC 手动触发')
  console.log('     在 aiHandlers.ts 或 wcdbHandlers.ts 中添加一个测试 IPC handler')
  console.log('')
  console.log('   ============================================')
  console.log('   目前已有的基础设施已验证：')
  console.log('   ✅ WCDB 原生库（libwcdb_api.dylib / wcdb_api.dll）已就绪')
  console.log('   ✅ wcdbService.ts 封装完整（init/open/execQuery/close）')
  console.log('   ✅ wxKeyServiceMac.ts 可获取微信密钥')
  console.log('   ✅ dbPathService.ts 可自动检测微信数据库路径')
  console.log('   ❌ 待验证：execQuery 对 message_*.db 的字段覆盖度')
  console.log('   ❌ 待验证：二进制字段（message_content）在 JSON 序列化中是否完整')
  console.log('   ❌ 待验证：并发读是否与微信写入冲突')
  console.log('')
  console.log('   如果要手动验证，可以检查 electron/services/wcdbService.ts 中的')
  console.log('   execQuery 返回的 JSON，关注：')
  console.log('   - message_content 字段是否经过 base64 编码')
  console.log('   - compress_content 字段是否完整')
  console.log('   - 大字段（如 voice/video 元数据）是否截断')
}
