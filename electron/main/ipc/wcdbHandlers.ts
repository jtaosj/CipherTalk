import { ipcMain } from 'electron'
import { dataManagementService } from '../../services/dataManagementService'
import { dbPathService } from '../../services/dbPathService'
import { wcdbService } from '../../services/wcdbService'
import { wxKeyServiceMac } from '../../services/wxKeyServiceMac'
import type { MainProcessContext } from '../context'

/**
 * WCDB 连接与解密 IPC。
 * 自动连接失败使用 warn，手动测试失败使用 error，便于日志侧区分场景。
 */
export function registerWcdbHandlers(ctx: MainProcessContext): void {
  ipcMain.handle('wcdb:testConnection', async (_, dbPath: string, hexKey: string, wxid: string, isAutoConnect = false) => {
    const logPrefix = isAutoConnect ? '自动连接' : '手动测试'
    ctx.getLogService()?.info('WCDB', `${logPrefix}数据库连接`, { dbPath, wxid, isAutoConnect })
    const result = await wcdbService.testConnection(dbPath, hexKey, wxid)
    if (result.success) {
      ctx.getLogService()?.info('WCDB', `${logPrefix}数据库连接成功`, { sessionCount: result.sessionCount })
    } else {
      // 自动连接失败使用WARN级别，手动测试失败使用ERROR级别
      const logLevel = isAutoConnect ? 'warn' : 'error'
      const errorInfo = {
        error: result.error || '未知错误',
        dbPath,
        wxid,
        keyLength: hexKey ? hexKey.length : 0,
        isAutoConnect
      }

      if (logLevel === 'warn') {
        ctx.getLogService()?.warn('WCDB', `${logPrefix}数据库连接失败`, errorInfo)
      } else {
        ctx.getLogService()?.error('WCDB', `${logPrefix}数据库连接失败`, errorInfo)
      }
    }
    return result
  })

  ipcMain.handle('wcdb:resolveValidWxid', async (_, dbPath: string, hexKey: string) => {
    try {
      const wxids = dbPathService.scanWxids(dbPath)
      if (wxids.length === 0) {
        return { success: false, error: '未检测到账号目录' }
      }

      for (const wxid of wxids) {
        const result = await wcdbService.testConnection(dbPath, hexKey, wxid)
        if (result.success) {
          return { success: true, wxid }
        }
      }

      return { success: false, error: '未找到可通过当前密钥验证的账号目录' }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('wcdb:open', async (_, dbPath: string, hexKey: string, wxid: string) => {
    return wcdbService.open(dbPath, hexKey, wxid)
  })

  ipcMain.handle('wcdb:close', async () => {
    wcdbService.close()
    return true
  })

  // 数据库解密
  ipcMain.handle('wcdb:decryptDatabase', async (event, dbPath: string, hexKey: string, wxid: string) => {
    ctx.getLogService()?.info('Decrypt', '开始解密数据库', { dbPath, wxid })

    try {
      // 使用已有的 dataManagementService 来解密
      const result = await dataManagementService.decryptAll()

      if (result.success) {
        ctx.getLogService()?.info('Decrypt', '解密完成', {
          successCount: result.successCount,
          failCount: result.failCount
        })

        return {
          success: true,
          totalFiles: (result.successCount || 0) + (result.failCount || 0),
          successCount: result.successCount,
          failCount: result.failCount
        }
      } else {
        ctx.getLogService()?.error('Decrypt', '解密失败', { error: result.error })
        return { success: false, error: result.error }
      }
    } catch (e) {
      ctx.getLogService()?.error('Decrypt', '解密异常', { error: String(e) })
      return { success: false, error: String(e) }
    }
  })

  // 数据管理相关

  // WCDB 直连验证：自动获取参数，测试 WCDB 能否直接读取微信的各加密数据库
  ipcMain.handle('wcdb:runDirectReadTest', async (_) => {
    const results: any[] = []
    const blockers: string[] = []

    try {
      // Step 1: 自动检测微信数据库路径
      const detectResult = await dbPathService.autoDetect()
      if (!detectResult.success || !detectResult.path) {
        return { success: false, error: `路径检测失败: ${detectResult.error || '未知错误'}` }
      }
      const dbPath = detectResult.path
      results.push({ step: '路径检测', success: true, detail: dbPath })

      // Step 2: 扫描 WXID
      const wxids = dbPathService.scanWxids(dbPath)
      if (wxids.length === 0) {
        return { success: false, error: '未检测到微信账号目录' }
      }
      const wxid = wxids[0]
      results.push({ step: 'WXID 扫描', success: true, detail: `${wxid} (共 ${wxids.length} 个账号)` })

      // Step 3: 获取数据库密钥
      const keyResult = await wxKeyServiceMac.autoGetDbKey(60_000)
      if (!keyResult.success || !keyResult.key) {
        return { success: false, error: `密钥获取失败: ${keyResult.error || '未知错误'}` }
      }
      const hexKey = keyResult.key
      results.push({ step: '密钥获取', success: true, detail: `${hexKey.slice(0, 8)}...${hexKey.slice(-8)}` })

      // Step 4: WCDB 初始化并连接
      const openSuccess = await wcdbService.open(dbPath, hexKey, wxid)
      if (!openSuccess) {
        return { success: false, error: 'WCDB 数据库连接失败（密钥错误或路径不匹配）' }
      }
      results.push({ step: 'WCDB 连接', success: true, detail: '已成功打开数据库句柄' })

      // Step 5: 逐库验证
      const mainDbQueries = [
        { kind: 'session', path: '', sql: "SELECT name FROM sqlite_master WHERE type='table'", label: 'session.db' },
        { kind: 'session', path: '', sql: 'SELECT * FROM SessionTable LIMIT 5', label: 'session.db → SessionTable' },
        { kind: 'contact', path: '', sql: "SELECT name FROM sqlite_master WHERE type='table'", label: 'contact.db' },
        { kind: 'contact', path: '', sql: 'SELECT username, nickname FROM contact LIMIT 5', label: 'contact.db → Contact' },
        { kind: 'emoticon', path: '', sql: "SELECT name FROM sqlite_master WHERE type='table'", label: 'emoticon.db' },
        { kind: 'emotion', path: '', sql: "SELECT name FROM sqlite_master WHERE type='table'", label: 'emotion.db' },
        { kind: 'misc', path: '', sql: "SELECT name FROM sqlite_master WHERE type='table'", label: 'misc.db' },
        { kind: 'head_image', path: '', sql: "SELECT name FROM sqlite_master WHERE type='table'", label: 'head_image.db' },
      ]

      for (const q of mainDbQueries) {
        const r = await wcdbService.execQuery(q.kind, q.path, q.sql)
        results.push({
          step: `查询: ${q.label}`,
          success: r.success,
          detail: r.success
            ? `返回 ${r.rows?.length || 0} 行`
            : `失败: ${r.error}`,
          fields: r.rows?.[0] ? Object.keys(r.rows[0]) : [],
          error: r.error,
        })
        if (!r.success) blockers.push(`${q.label}: ${r.error}`)
      }

      // Step 6: 扫描消息库
      const fs = require('fs')
      const path = require('path')
      const storageDir = path.join(dbPath, wxid, 'db_storage')

      if (fs.existsSync(storageDir)) {
        const dbFiles = (fs.readdirSync(storageDir) as string[])
          .filter((f: string) => f.endsWith('.db') && (f.startsWith('message') || f.startsWith('msg')))

        results.push({ step: '消息库扫描', success: true, detail: `发现 ${dbFiles.length} 个消息库` })

        for (const dbFile of dbFiles.slice(0, 3)) {
          // 查表
          const tableR = await wcdbService.execQuery('message', dbFile, "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'Msg_%' OR name LIKE 'msg_%')")
          if (!tableR.success || !tableR.rows?.length) {
            results.push({ step: `${dbFile}`, success: false, detail: `查表失败: ${tableR.error}` })
            continue
          }

          const tableName = tableR.rows[0].name
          // 取 3 条消息
          const data = await wcdbService.execQuery('message', dbFile, `SELECT * FROM \`${tableName}\` ORDER BY sort_seq DESC LIMIT 3`)
          if (data.success && data.rows?.length) {
            const row = data.rows[0]
            const fields = Object.keys(row)
            const hasContent = 'message_content' in row
            const contentLen = hasContent ? String(row.message_content).length : 0
            const hasCompress = 'compress_content' in row

            results.push({
              step: `${dbFile} → ${tableName}`,
              success: true,
              detail: `${data.rows.length} 行`,
              fields,
              hasMessageContent: hasContent,
              contentSampleLen: contentLen > 200 ? `${(contentLen / 1024).toFixed(1)} KB` : `${contentLen} B`,
              hasCompressContent: hasCompress,
              isContentString: typeof row.message_content === 'string',
            })

            // 完整性检查
            if (typeof row.message_content === 'string' && contentLen > 0) {
              results.push({
                step: `  ↳ message_content 完整性`,
                success: true,
                detail: `字段存在，字符串长度 ${contentLen} 字节`,
                note: '需确认是否完整（可用 chatService 解析对比）',
              })
            } else if (row.message_content === null || row.message_content === undefined) {
              results.push({
                step: `  ↳ message_content`,
                success: true,
                detail: '字段为空值（部分消息可能无内容）',
              })
            }
          } else {
            results.push({ step: `${dbFile} → ${tableName}`, success: false, detail: `查询失败: ${data.error}` })
          }
        }
      } else {
        results.push({ step: '消息库扫描', success: false, detail: `路径不存在: ${storageDir}` })
      }

      // 清理
      wcdbService.close()

      // 生成结论
      const successCount = results.filter(r => r.success).length
      const totalCount = results.length
      const score = Math.round(successCount / totalCount * 100)

      let verdict: string
      if (score >= 80) {
        verdict = '🟢 推荐迁移直连'
      } else if (score >= 50) {
        verdict = '🟡 有条件迁移（需排查失败项）'
      } else {
        verdict = '🔴 暂不推荐'
      }

      return {
        success: true,
        results,
        summary: {
          successCount,
          totalCount,
          score,
          verdict,
          blockers: blockers.length > 0 ? blockers : undefined,
        },
      }
    } catch (e: any) {
      return { success: false, error: `验证异常: ${e.message}`, results }
    }
  })

}
