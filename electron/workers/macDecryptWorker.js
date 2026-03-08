/**
 * macOS 数据库解密 Worker (macDecryptWorker.js)
 *
 * 在独立线程中加载 mac_decrypt_db.dylib 执行解密。
 * 对标 Windows 的 decryptWorker.js。
 */

const { parentPort, workerData } = require('worker_threads')
const path = require('path')
const fs = require('fs')
const koffi = require('koffi')

// 从 workerData 获取 dylib 路径
const { dylibPath } = workerData

if (!dylibPath || !fs.existsSync(dylibPath)) {
    parentPort?.postMessage({ type: 'error', error: 'dylib path not found: ' + dylibPath })
    process.exit(1)
}

try {
    // 加载 dylib
    const lib = koffi.load(dylibPath)

    // 定义回调类型
    const ProgressCallback = koffi.proto('void ProgressCallback(int current, int total)')

    // 绑定函数（API 与 Windows wcdb_decrypt.dll 对标）
    const MacDec_DecryptDatabaseWithProgress = lib.func(
        'int MacDec_DecryptDatabaseWithProgress(const char* inputPath, const char* outputPath, const char* hexKey, ProgressCallback* callback)'
    )
    const MacDec_GetLastErrorMsg = lib.func(
        'int MacDec_GetLastErrorMsg(char* buffer, int size)'
    )

    // 监听主线程消息
    parentPort?.on('message', (message) => {
        if (message.type === 'decrypt') {
            const { id, inputPath, outputPath, hexKey } = message

            try {
                // 确保输出目录存在
                const outputDir = path.dirname(outputPath)
                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true })
                }

                // 定义进度回调（带节流）
                let lastUpdate = 0

                const onProgress = koffi.register((current, total) => {
                    const now = Date.now()
                    if (now - lastUpdate > 100 || current === total || current === 1) {
                        lastUpdate = now
                        parentPort?.postMessage({
                            type: 'progress',
                            id,
                            current,
                            total
                        })
                    }
                }, koffi.pointer(ProgressCallback))

                // 执行解密
                const result = MacDec_DecryptDatabaseWithProgress(inputPath, outputPath, hexKey, onProgress)

                // 注销回调
                koffi.unregister(onProgress)

                if (result === 0) {
                    parentPort?.postMessage({ type: 'success', id })
                } else {
                    // 获取错误信息
                    const buffer = Buffer.alloc(512)
                    MacDec_GetLastErrorMsg(buffer, 512)
                    const errorMsg = buffer.toString('utf8').replace(/\0+$/, '')

                    parentPort?.postMessage({
                        type: 'error',
                        id,
                        error: errorMsg || `ErrorCode: ${result}`
                    })
                }
            } catch (err) {
                parentPort?.postMessage({
                    type: 'error',
                    id,
                    error: String(err)
                })
            }
        }
    })

    // 通知主线程 Worker 已就绪
    parentPort?.postMessage({ type: 'ready' })

} catch (err) {
    parentPort?.postMessage({ type: 'error', error: String(err) })
}
