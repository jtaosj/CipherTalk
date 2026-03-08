/**
 * macOS 微信密钥提取服务 (macWxKeyService.ts)
 *
 * 通过 koffi 加载 mac_wx_key.dylib，提供与 Windows wxKeyService 类似的接口。
 * 使用后台线程进行内存扫描，通过轮询获取进度和结果。
 */

import { execSync } from 'child_process'
import { join } from 'path'
import { app } from 'electron'
import { existsSync, readdirSync, statSync } from 'fs'

export class MacWxKeyService {
  private lib: any = null
  private pollingTimer: NodeJS.Timeout | null = null
  private onKeysReceived: ((keys: Record<string, string>) => void) | null = null
  private onStatus: ((status: string, level: number) => void) | null = null

  /**
   * 获取 dylib 路径
   */
  getDylibPath(): string {
    const resourcesPath = app.isPackaged
      ? join(process.resourcesPath, 'resources', 'mac')
      : join(app.getAppPath(), 'resources', 'mac')

    return join(resourcesPath, 'mac_wx_key.dylib')
  }

  /**
   * 检查微信进程是否运行
   */
  isWeChatRunning(): boolean {
    if (this.lib) {
      try {
        const MacKey_IsWeChatRunning = this.lib.func('bool MacKey_IsWeChatRunning()')
        return MacKey_IsWeChatRunning()
      } catch { }
    }

    // Fallback: use pgrep
    try {
      execSync('pgrep -x WeChat', { encoding: 'utf8' })
      return true
    } catch {
      return false
    }
  }

  /**
   * 获取微信进程 PID
   */
  getWeChatPid(): number | null {
    if (this.lib) {
      try {
        const MacKey_FindWeChatPid = this.lib.func('uint32_t MacKey_FindWeChatPid()')
        const pid = MacKey_FindWeChatPid()
        return pid > 0 ? pid : null
      } catch { }
    }

    // Fallback: pgrep
    try {
      const result = execSync('pgrep -x WeChat', { encoding: 'utf8' }).trim()
      const pid = parseInt(result, 10)
      return isNaN(pid) ? null : pid
    } catch {
      return null
    }
  }

  /**
   * 关闭微信进程
   */
  killWeChat(): boolean {
    try {
      const pid = this.getWeChatPid()
      if (pid) {
        execSync(`kill ${pid}`, { encoding: 'utf8' })
        return true
      }
      return false
    } catch {
      return false
    }
  }

  /**
   * 获取微信安装路径 (macOS)
   */
  getWeChatPath(): string | null {
    const paths = [
      '/Applications/WeChat.app/Contents/MacOS/WeChat',
      join(require('os').homedir(), 'Applications/WeChat.app/Contents/MacOS/WeChat')
    ]

    for (const p of paths) {
      if (existsSync(p)) return p
    }

    // Try mdfind
    try {
      const result = execSync('mdfind "kMDItemCFBundleIdentifier == com.tencent.xinWeChat"', { encoding: 'utf8' }).trim()
      const appPath = result.split('\n')[0]
      if (appPath) {
        const execPath = join(appPath, 'Contents/MacOS/WeChat')
        if (existsSync(execPath)) return execPath
      }
    } catch { }

    return null
  }

  /**
   * 启动微信
   */
  async launchWeChat(customPath?: string): Promise<boolean> {
    try {
      execSync('open -a WeChat', { encoding: 'utf8' })
      await new Promise(resolve => setTimeout(resolve, 2000))
      return this.isWeChatRunning()
    } catch {
      return false
    }
  }

  /**
   * 等待微信窗口出现
   */
  async waitForWeChatWindow(maxWaitSeconds = 15): Promise<boolean> {
    for (let i = 0; i < maxWaitSeconds * 2; i++) {
      await new Promise(resolve => setTimeout(resolve, 500))
      if (this.isWeChatRunning()) return true
    }
    return false
  }

  /**
   * 初始化 dylib (使用 koffi)
   */
  async initialize(): Promise<boolean> {
    try {
      const koffi = require('koffi')
      const dylibPath = this.getDylibPath()

      console.log('[MacWxKey] 加载 dylib:', dylibPath)

      if (!existsSync(dylibPath)) {
        console.error('[MacWxKey] dylib 文件不存在:', dylibPath)
        return false
      }

      this.lib = koffi.load(dylibPath)
      return true
    } catch (e) {
      console.error('[MacWxKey] 初始化 dylib 失败:', e)
      return false
    }
  }

  /**
   * 开始密钥扫描
   * @param dbStorageDir db_storage 目录路径
   * @param onKeysReceived 密钥获取成功回调
   * @param onStatus 状态回调
   */
  startKeyScan(
    dbStorageDir: string,
    onKeysReceived: (keys: Record<string, string>) => void,
    onStatus?: (status: string, level: number) => void
  ): boolean {
    if (!this.lib) return false

    try {
      this.onKeysReceived = onKeysReceived
      this.onStatus = onStatus || null

      const MacKey_StartScan = this.lib.func('bool MacKey_StartScan(const char*)')
      const success = MacKey_StartScan(dbStorageDir)

      if (success) {
        this.startPolling()
      }

      return success
    } catch (e) {
      console.error('[MacWxKey] 启动扫描失败:', e)
      return false
    }
  }

  /**
   * 开始轮询
   */
  private startPolling(): void {
    this.stopPolling()

    this.pollingTimer = setInterval(() => {
      this.pollData()
    }, 200) // 200ms interval for macOS scan
  }

  /**
   * 停止轮询
   */
  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer)
      this.pollingTimer = null
    }
  }

  /**
   * 轮询数据
   */
  private pollData(): void {
    if (!this.lib) return

    try {
      const koffi = require('koffi')

      // 轮询状态消息
      const GetStatusMessage = this.lib.func('bool MacKey_GetStatusMessage(char*, int, int*)')
      for (let i = 0; i < 5; i++) {
        const statusBuffer = Buffer.alloc(256)
        const levelBuffer = Buffer.alloc(4)
        if (GetStatusMessage(statusBuffer, 256, levelBuffer)) {
          const status = statusBuffer.toString('utf8').replace(/\0/g, '').trim()
          const level = levelBuffer.readInt32LE(0)
          if (this.onStatus) {
            this.onStatus(status, level)
          }
        } else {
          break
        }
      }

      // 检查扫描是否完成
      const IsScanRunning = this.lib.func('bool MacKey_IsScanRunning()')
      if (!IsScanRunning()) {
        // 扫描完成，获取结果
        const GetResult = this.lib.func('bool MacKey_GetResult(char*, int)')
        const resultBuffer = Buffer.alloc(128 * 1024) // 128KB
        if (GetResult(resultBuffer, resultBuffer.length)) {
          const json = resultBuffer.toString('utf8').replace(/\0/g, '').trim()
          try {
            const result = JSON.parse(json)
            if (result.success && result.keys && this.onKeysReceived) {
              this.onKeysReceived(result.keys)
            }
          } catch (e) {
            console.error('[MacWxKey] 解析结果失败:', e)
          }
        } else {
          // 扫描失败
          const GetLastError = this.lib.func('const char* MacKey_GetLastError()')
          const error = GetLastError()
          if (this.onStatus) {
            this.onStatus(`扫描失败: ${error}`, 3)
          }
        }

        this.stopPolling()
      }
    } catch (e) {
      console.error('[MacWxKey] 轮询数据失败:', e)
    }
  }

  /**
   * 获取扫描进度 (0-100)
   */
  getProgress(): number {
    if (!this.lib) return 0
    try {
      const GetProgress = this.lib.func('int MacKey_GetProgress()')
      return GetProgress()
    } catch {
      return 0
    }
  }

  /**
   * 取消扫描
   */
  cancelScan(): void {
    if (!this.lib) return
    try {
      const CancelScan = this.lib.func('void MacKey_CancelScan()')
      CancelScan()
    } catch { }
    this.stopPolling()
  }

  /**
   * 获取最后错误信息
   */
  getLastError(): string {
    if (!this.lib) return '未知错误'
    try {
      const GetLastError = this.lib.func('const char* MacKey_GetLastError()')
      return GetLastError() || '无错误'
    } catch {
      return '获取错误信息失败'
    }
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.stopPolling()
    if (this.lib) {
      try {
        const Cleanup = this.lib.func('void MacKey_Cleanup()')
        Cleanup()
      } catch { }
    }
    this.lib = null
    this.onKeysReceived = null
    this.onStatus = null
  }

  /**
   * 检测当前登录的微信账号 (macOS)
   */
  detectCurrentAccount(dbPath?: string, maxTimeDiffMinutes: number = 5): { wxid: string; dbPath: string } | null {
    try {
      if (!dbPath) return null
      if (!existsSync(dbPath)) return null

      const now = Date.now()
      const maxTimeDiffMs = maxTimeDiffMinutes * 60 * 1000
      let bestMatch: { wxid: string; dbPath: string; timeDiff: number } | null = null
      let fallbackMatch: { wxid: string; dbPath: string; timeDiff: number } | null = null

      const entries = readdirSync(dbPath, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const accountDirName = entry.name
        const accountDir = join(dbPath, accountDirName)

        const dbStorageDir = join(accountDir, 'db_storage')
        if (!existsSync(dbStorageDir)) continue

        // 过滤系统目录
        const lower = accountDirName.toLowerCase()
        if (['all', 'applet', 'backup', 'wmpf', 'system', 'temp', 'cache'].some(d => lower.startsWith(d))) continue

        const modifiedTime = statSync(accountDir).mtimeMs
        const timeDiff = Math.abs(now - modifiedTime)

        if (timeDiff <= maxTimeDiffMs) {
          if (!bestMatch || timeDiff < bestMatch.timeDiff) {
            bestMatch = { wxid: accountDirName, dbPath: accountDir, timeDiff }
          }
        }

        if (!fallbackMatch || timeDiff < fallbackMatch.timeDiff) {
          fallbackMatch = { wxid: accountDirName, dbPath: accountDir, timeDiff }
        }
      }

      if (bestMatch) return { wxid: bestMatch.wxid, dbPath: bestMatch.dbPath }

      if (fallbackMatch) {
        const validEntries = entries.filter(e =>
          e.isDirectory() &&
          existsSync(join(dbPath, e.name, 'db_storage')) &&
          !['all', 'applet', 'backup', 'wmpf', 'system', 'temp', 'cache'].some(d => e.name.toLowerCase().startsWith(d))
        )
        if (validEntries.length === 1 || (fallbackMatch.timeDiff <= 24 * 60 * 60 * 1000)) {
          return { wxid: fallbackMatch.wxid, dbPath: fallbackMatch.dbPath }
        }
      }

      return null
    } catch {
      return null
    }
  }
}

// 单例
export const macWxKeyService = new MacWxKeyService()
