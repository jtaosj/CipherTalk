/**
 * macOS 数据库解密服务 (Worker 多线程版)
 *
 * 使用独立的 Worker 线程加载 dylib 并执行解密，
 * 与 Windows nativeDecryptService.ts 架构一致。
 */

import * as path from 'path'
import * as fs from 'fs'
import { app } from 'electron'
import { Worker } from 'worker_threads'

const generateId = () => Math.random().toString(36).substring(2, 15)

interface DecryptTask {
    resolve: (value: { success: boolean; error?: string }) => void
    onProgress?: (current: number, total: number) => void
}

export class MacDecryptService {
    private worker: Worker | null = null
    private dylibPath: string | null = null
    private initialized: boolean = false
    private initError: string | null = null
    private tasks: Map<string, DecryptTask> = new Map()

    constructor() {
        this.init()
    }

    private init(): void {
        if (this.initialized) return

        try {
            this.dylibPath = this.findDylibPath()
            if (!this.dylibPath) {
                this.initError = '未找到 mac_decrypt_db.dylib'
                console.warn('[MacDecrypt] ' + this.initError)
                return
            }

            const workerScript = this.findWorkerPath()
            if (!workerScript) {
                this.initError = '未找到 macDecryptWorker.js'
                console.warn('[MacDecrypt] ' + this.initError)
                return
            }

            console.log('[MacDecrypt] 启动 Worker:', workerScript)
            console.log('[MacDecrypt] dylib 路径:', this.dylibPath)

            this.worker = new Worker(workerScript, {
                workerData: { dylibPath: this.dylibPath }
            })

            this.worker.on('message', (msg) => this.handleWorkerMessage(msg))
            this.worker.on('error', (err: Error) => {
                console.error('[MacDecrypt] Worker 错误:', err)
                this.initError = `Worker error: ${err.message}`
            })
            this.worker.on('exit', (code) => {
                if (code !== 0) {
                    console.error(`[MacDecrypt] Worker 异常退出，代码: ${code}`)
                    this.worker = null
                    this.initialized = false
                }
            })

            this.initialized = true
        } catch (e) {
            this.initError = `初始化失败: ${e}`
            console.error('[MacDecrypt]', this.initError)
        }
    }

    private handleWorkerMessage(msg: any): void {
        if (msg.type === 'ready') {
            console.log('[MacDecrypt] Worker 已就绪')
            return
        }

        const task = this.tasks.get(msg.id)
        if (!task) return

        switch (msg.type) {
            case 'success':
                task.resolve({ success: true })
                this.tasks.delete(msg.id)
                break
            case 'error':
                task.resolve({ success: false, error: msg.error })
                this.tasks.delete(msg.id)
                break
            case 'progress':
                if (task.onProgress) {
                    task.onProgress(msg.current, msg.total)
                }
                break
        }
    }

    private findDylibPath(): string | null {
        const candidates: string[] = []
        if (app.isPackaged) {
            candidates.push(
                path.join(process.resourcesPath, 'resources', 'mac', 'mac_decrypt_db.dylib'),
                path.join(process.resourcesPath, 'mac', 'mac_decrypt_db.dylib'),
                path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'mac', 'mac_decrypt_db.dylib')
            )
        } else {
            candidates.push(
                path.join(app.getAppPath(), 'resources', 'mac', 'mac_decrypt_db.dylib')
            )
        }
        return candidates.find(p => fs.existsSync(p)) || null
    }

    private findWorkerPath(): string | null {
        const candidates: string[] = []
        if (app.isPackaged) {
            candidates.push(
                path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'workers', 'macDecryptWorker.js'),
                path.join(process.resourcesPath, 'dist-electron', 'workers', 'macDecryptWorker.js'),
                path.join(__dirname, 'workers', 'macDecryptWorker.js'),
                path.join(__dirname, '..', 'workers', 'macDecryptWorker.js')
            )
        } else {
            candidates.push(
                path.join(app.getAppPath(), 'electron', 'workers', 'macDecryptWorker.js'),
                path.join(__dirname, '..', 'workers', 'macDecryptWorker.js')
            )
        }

        const found = candidates.find(p => fs.existsSync(p))
        if (found) {
            console.log('[MacDecrypt] 找到 Worker:', found)
        } else {
            console.error('[MacDecrypt] 未找到 Worker，尝试的路径:', candidates)
        }
        return found || null
    }

    isAvailable(): boolean {
        return this.initialized && this.worker !== null
    }

    async decryptDatabaseAsync(
        inputPath: string,
        outputPath: string,
        hexKey: string,
        onProgress?: (current: number, total: number) => void
    ): Promise<{ success: boolean; error?: string }> {
        if (!this.worker) {
            if (!this.initialized && !this.initError) {
                this.init()
            }
            if (!this.worker) {
                return { success: false, error: this.initError || 'Worker 未启动' }
            }
        }

        return new Promise((resolve) => {
            const id = generateId()
            this.tasks.set(id, { resolve, onProgress })
            this.worker!.postMessage({
                type: 'decrypt',
                id,
                inputPath,
                outputPath,
                hexKey
            })
        })
    }
}

export const macDecryptService = new MacDecryptService()
