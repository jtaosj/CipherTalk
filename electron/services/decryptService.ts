import { nativeDecryptService } from './nativeDecryptService'
import { macDecryptService } from './macDecryptService'

const isMac = process.platform === 'darwin'

/**
 * 微信数据库解密服务 (Windows v4)
 * 纯原生 DLL 实现封装
 */
export class WeChatDecryptService {

  /**
   * 验证密钥是否正确
   * 目前未实现单独的验证逻辑，依赖解密过程中的验证
   */
  validateKey(dbPath: string, hexKey: string): boolean {
    return true
  }

  /**
   * 解密数据库
   * 使用原生 DLL 解密（高性能、异步不卡顿）
   */
  async decryptDatabase(
    inputPath: string,
    outputPath: string,
    hexKey: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<{ success: boolean; error?: string }> {

    // 检查服务是否可用
    if (isMac) {
      if (!macDecryptService.isAvailable()) {
        return { success: false, error: 'macOS 原生解密服务不可用：dylib 加载失败或 Worker 未启动' }
      }
    } else {
      if (!nativeDecryptService.isAvailable()) {
        return { success: false, error: 'Windows 原生解密服务不可用：DLL 加载失败或 Worker 未启动' }
      }
    }

    try {
      // 使用异步解密
      let result
      if (isMac) {
        result = await macDecryptService.decryptDatabaseAsync(inputPath, outputPath, hexKey, onProgress)
      } else {
        result = await nativeDecryptService.decryptDatabaseAsync(inputPath, outputPath, hexKey, onProgress)
      }

      if (result.success) {
        return { success: true }
      } else {
        console.warn(`[Decrypt] 解密失败: ${result.error}`)
        return { success: false, error: result.error }
      }
    } catch (e) {
      console.error('[Decrypt] 调用异常:', e)
      return { success: false, error: String(e) }
    }
  }
}

export const wechatDecryptService = new WeChatDecryptService()
