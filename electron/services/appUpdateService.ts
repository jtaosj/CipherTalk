import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

const GITHUB_OWNER = 'ILoveBingLu'
const GITHUB_REPO = 'CipherTalk'
const GITHUB_FORCE_UPDATE_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download/force-update.json`
const FORCE_UPDATE_POLICY_FALLBACK_URL = 'https://miyuapp.aiqji.com'

export type ForceUpdateReason = 'minimum-version' | 'blocked-version'
export type AppUpdateSource = 'github' | 'custom' | 'none'
export type UpdateDownloadPhase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'failed'
export type UpdateDownloadStrategy = 'unknown' | 'differential' | 'full'

export interface ForceUpdateManifest {
  schemaVersion: number
  latestVersion?: string
  minimumSupportedVersion?: string
  blockedVersions?: string[]
  title?: string
  message?: string
  releaseNotes?: string
  publishedAt?: string
}

export interface AppUpdateInfo {
  hasUpdate: boolean
  forceUpdate: boolean
  currentVersion: string
  version?: string
  releaseNotes?: string
  title?: string
  message?: string
  minimumSupportedVersion?: string
  reason?: ForceUpdateReason
  checkedAt: number
  updateSource: AppUpdateSource
  policySource: AppUpdateSource
  diagnostics?: UpdateDiagnostics
}

export interface UpdateDiagnostics {
  phase: UpdateDownloadPhase
  strategy: UpdateDownloadStrategy
  fallbackToFull: boolean
  lastError?: string
  lastEvent?: string
  progressPercent?: number
  downloadedBytes?: number
  totalBytes?: number
  targetVersion?: string
  lastUpdatedAt: number
}

type ManifestLookupResult = {
  manifest: ForceUpdateManifest | null
  source: AppUpdateSource
}

function isNewerVersion(version1: string, version2: string): boolean {
  const v1Parts = version1.split('.').map(Number)
  const v2Parts = version2.split('.').map(Number)
  const maxLength = Math.max(v1Parts.length, v2Parts.length)
  while (v1Parts.length < maxLength) v1Parts.push(0)
  while (v2Parts.length < maxLength) v2Parts.push(0)

  for (let i = 0; i < maxLength; i++) {
    if (v1Parts[i] > v2Parts[i]) return true
    if (v1Parts[i] < v2Parts[i]) return false
  }

  return false
}

function isVersionEqual(version1: string, version2: string): boolean {
  return !isNewerVersion(version1, version2) && !isNewerVersion(version2, version1)
}

function normalizeReleaseNotes(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && 'note' in item) {
        return String((item as { note?: unknown }).note || '')
      }
      return String(item)
    }).filter(Boolean).join('\n\n')
  }
  if (value && typeof value === 'object' && 'note' in value) {
    return String((value as { note?: unknown }).note || '')
  }
  return String(value)
}

async function fetchManifestFromUrl(url: string): Promise<ForceUpdateManifest | null> {
  try {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json'
      }
    })
    if (!response.ok) return null

    const data = await response.json() as ForceUpdateManifest
    if (!data || typeof data !== 'object') return null
    if (Number(data.schemaVersion || 0) < 1) return null
    return data
  } catch (error) {
    console.warn('[AppUpdate] 获取策略文件失败:', url, error)
    return null
  }
}

async function resolveForceUpdateManifest(): Promise<ManifestLookupResult> {
  const githubManifest = await fetchManifestFromUrl(GITHUB_FORCE_UPDATE_URL)
  if (githubManifest) {
    return { manifest: githubManifest, source: 'github' }
  }

  const fallbackUrl = `${FORCE_UPDATE_POLICY_FALLBACK_URL.replace(/\/+$/, '')}/force-update.json`
  const customManifest = await fetchManifestFromUrl(fallbackUrl)
  if (customManifest) {
    return { manifest: customManifest, source: 'custom' }
  }

  return { manifest: null, source: 'none' }
}

class AppUpdateService {
  private lastInfo: AppUpdateInfo | null = null
  private diagnostics: UpdateDiagnostics = {
    phase: 'idle',
    strategy: 'unknown',
    fallbackToFull: false,
    lastUpdatedAt: Date.now()
  }

  getCachedUpdateInfo(): AppUpdateInfo | null {
    return this.lastInfo
  }

  getForceUpdatePolicyFallbackUrl(): string {
    return FORCE_UPDATE_POLICY_FALLBACK_URL
  }

  getGithubRepository(): { owner: string; repo: string } {
    return {
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO
    }
  }

  private buildInfo(payload: Partial<AppUpdateInfo>): AppUpdateInfo {
    return {
      hasUpdate: false,
      forceUpdate: false,
      currentVersion: app.getVersion(),
      checkedAt: Date.now(),
      updateSource: 'none',
      policySource: 'none',
      diagnostics: this.diagnostics,
      ...payload
    }
  }

  resetDiagnostics(targetVersion?: string): void {
    this.diagnostics = {
      phase: 'idle',
      strategy: 'unknown',
      fallbackToFull: false,
      targetVersion,
      lastUpdatedAt: Date.now()
    }
  }

  updateDiagnostics(patch: Partial<UpdateDiagnostics>): void {
    this.diagnostics = {
      ...this.diagnostics,
      ...patch,
      lastUpdatedAt: Date.now()
    }

    if (this.lastInfo) {
      this.lastInfo = {
        ...this.lastInfo,
        diagnostics: this.diagnostics
      }
    }
  }

  noteUpdaterMessage(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const normalized = message.toLowerCase()
    const patch: Partial<UpdateDiagnostics> = { lastEvent: message }

    if (normalized.includes('differential')) {
      patch.strategy = 'differential'
    }

    if (
      normalized.includes('fallback to full') ||
      normalized.includes('fallback to full download') ||
      normalized.includes('cannot download differentially') ||
      normalized.includes('cannot download differentially, fallback to full download')
    ) {
      patch.strategy = 'full'
      patch.fallbackToFull = true
      patch.lastEvent = '差分更新失败，已回退到全量下载'
      if (this.diagnostics.phase === 'idle') {
        patch.phase = 'downloading'
      }
    }

    if (level === 'error') {
      patch.lastError = message
      if (this.diagnostics.phase !== 'downloaded' && this.diagnostics.phase !== 'installing') {
        patch.phase = 'failed'
      }
    }

    this.updateDiagnostics(patch)
  }

  async checkForUpdates(): Promise<AppUpdateInfo> {
    const currentVersion = app.getVersion()
    let latestVersion: string | undefined
    let releaseNotes = ''
    let hasUpdate = false
    let updateSource: AppUpdateSource = 'none'

    this.resetDiagnostics()
    this.updateDiagnostics({
      phase: 'checking',
      lastEvent: '开始检查更新'
    })

    try {
      const result = await autoUpdater.checkForUpdates()
      if (result?.updateInfo?.version) {
        latestVersion = result.updateInfo.version
        releaseNotes = normalizeReleaseNotes(result.updateInfo.releaseNotes)
        hasUpdate = isNewerVersion(latestVersion, currentVersion)
        updateSource = hasUpdate ? 'github' : 'none'
        this.updateDiagnostics({
          phase: hasUpdate ? 'available' : 'idle',
          targetVersion: latestVersion,
          lastEvent: hasUpdate ? `检测到新版本 ${latestVersion}` : '当前已是最新版本'
        })
      } else {
        this.updateDiagnostics({
          phase: 'idle',
          lastEvent: '未获取到远端版本信息'
        })
      }
    } catch (error) {
      this.updateDiagnostics({
        phase: 'failed',
        lastError: String(error),
        lastEvent: '检查更新失败'
      })
      console.error('[AppUpdate] 检查 GitHub 更新失败:', error)
    }

    const { manifest, source: policySource } = await resolveForceUpdateManifest()
    let forceUpdate = false
    let reason: ForceUpdateReason | undefined

    if (manifest?.minimumSupportedVersion && isNewerVersion(manifest.minimumSupportedVersion, currentVersion)) {
      forceUpdate = true
      reason = 'minimum-version'
    } else if (manifest?.blockedVersions?.some((version) => isVersionEqual(currentVersion, version))) {
      forceUpdate = true
      reason = 'blocked-version'
    }

    const finalVersion = latestVersion || manifest?.latestVersion
    const finalReleaseNotes = releaseNotes || manifest?.releaseNotes || ''

    const info = this.buildInfo({
      hasUpdate: hasUpdate || forceUpdate,
      forceUpdate,
      currentVersion,
      version: finalVersion,
      releaseNotes: finalReleaseNotes,
      title: manifest?.title || (forceUpdate ? '必须更新到最新版本' : undefined),
      message: manifest?.message,
      minimumSupportedVersion: manifest?.minimumSupportedVersion,
      reason,
      updateSource,
      policySource
    })

    this.lastInfo = info
    return info
  }
}

export const appUpdateService = new AppUpdateService()
